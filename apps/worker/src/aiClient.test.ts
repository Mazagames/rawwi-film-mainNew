import test from "node:test";
import assert from "node:assert";
import nock from "nock";
import { config, getAIProviderPolicy, resolveModelForRole } from "./config.js";
import { classifyProviderFailure, generateStructuredCompletion } from "./aiClient.js";

// Ensure keys are set before aiClient initialization
(config as any).OPENAI_API_KEY = "mock-openai";
(config as any).GEMINI_API_KEY = "mock-gemini";

test("aiClient - abstraction tests", async (t) => {
  const originalProvider = config.AI_PROVIDER;
  const originalProviderMode = process.env.AI_PROVIDER_MODE;

  t.beforeEach(() => {
    nock.disableNetConnect();
  });

  t.afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    (config as any).AI_PROVIDER = originalProvider;
    if (originalProviderMode === undefined) delete process.env.AI_PROVIDER_MODE;
    else process.env.AI_PROVIDER_MODE = originalProviderMode;
  });

  await t.test("AI_PROVIDER=openai selects OpenAI adapter and normalizes response", async () => {
    (config as any).AI_PROVIDER = "openai";

    const scope = nock("https://api.openai.com")
      .post("/v1/chat/completions")
      .reply(200, function (uri, requestBody) {
        // requestBody can be string or object depending on interceptor setup
        const body = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
        assert.strictEqual(body.messages[0].content, "sys-openai");
        assert.strictEqual(body.messages[1].content, "usr-openai");
        assert.deepStrictEqual(body.response_format, { type: "json_object" });
        assert.strictEqual(body.temperature, 0.5);
        assert.strictEqual(body.seed, 12345);
        assert.strictEqual(body.max_tokens, 4096);

        return {
          id: "mock-openai-id",
          choices: [{
            message: { content: '{"test":"openai"}' },
            finish_reason: "stop"
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30
          }
        };
      });

    const resp = await generateStructuredCompletion({
      model: "gpt-mock",
      systemPrompt: "sys-openai",
      userPrompt: "usr-openai",
      temperature: 0.5,
      seed: 12345,
      maxTokens: 4096
    });

    assert.ok(scope.isDone(), "OpenAI API should have been called");
    assert.strictEqual(resp.content, '{"test":"openai"}');
    assert.strictEqual(resp.finishReason, "stop");
    assert.strictEqual(resp.responseId, "mock-openai-id");
    assert.deepStrictEqual(resp.usage, {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30
    });
  });

  await t.test("AI_PROVIDER=gemini selects Gemini adapter and normalizes response", async () => {
    (config as any).AI_PROVIDER = "gemini";

    const scope = nock("https://generativelanguage.googleapis.com")
      .post("/v1beta/models/gemini-mock:generateContent")
      .reply(200, function (uri, requestBody) {
        const body = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
        
        assert.strictEqual(body.systemInstruction.parts[0].text, "sys-gemini");
        assert.strictEqual(body.contents[0].parts[0].text, "usr-gemini");
        assert.strictEqual(body.generationConfig.responseMimeType, "application/json");
        assert.strictEqual(body.generationConfig.temperature, 0.2);

        return {
          candidates: [
            {
              content: { parts: [{ text: '{"test":"gemini"}' }] },
              finishReason: "STOP"
            }
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 25,
            totalTokenCount: 40
          }
        };
      });

    const resp = await generateStructuredCompletion({
      model: "gemini-mock",
      systemPrompt: "sys-gemini",
      userPrompt: "usr-gemini",
      temperature: 0.2
    });

    assert.ok(scope.isDone(), "Gemini API should have been called");
    assert.strictEqual(resp.content, '{"test":"gemini"}');
    assert.strictEqual(resp.finishReason, "stop");
    assert.strictEqual(resp.responseId, null);
    assert.deepStrictEqual(resp.usage, {
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40
    });
  });

  await t.test("AbortSignal reaches the provider layer", async () => {
    (config as any).AI_PROVIDER = "openai";
    
    // For abort we want the request to hang so the abort triggers first
    const scope = nock("https://api.openai.com")
      .post("/v1/chat/completions")
      .delay(1000)
      .reply(200, {});

    const ac = new AbortController();
    
    const promise = generateStructuredCompletion({
      model: "gpt-mock",
      systemPrompt: "sys",
      userPrompt: "usr",
      signal: ac.signal
    });
    
    // trigger abort immediately
    ac.abort();
    
    let error: any = null;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    
    nock.cleanAll();
    
    assert.ok(error, "Should throw an error due to abort");
    assert.ok(
      error.message.includes("abort") || 
      error.message.includes("Cancel") || 
      error.name === "AbortError" || 
      error.message.includes("signal"),
      `Error should be related to abort, got: ${error.message}`
    );
  });

  await t.test("AI_PROVIDER=openai works without GEMINI_API_KEY", async () => {
    (config as any).AI_PROVIDER = "openai";
    (config as any).GEMINI_API_KEY = "";
    (config as any).OPENAI_API_KEY = "mock-openai";

    // Re-initialize module cache if needed, but since we use lazy initialization in aiClient.ts
    // setting config before the call is sufficient. We must reset `openai` and `gemini` instances
    // but they are module-scoped. Fortunately, for this test, as long as it doesn't throw on GEMINI it's fine.
    
    // We already initialized openai in earlier tests, so we can just assert it doesn't throw about GEMINI.
    const scope = nock("https://api.openai.com")
      .post("/v1/chat/completions")
      .reply(200, { choices: [{ message: { content: '{"test":"ok"}' }, finish_reason: "stop" }] });

    const resp = await generateStructuredCompletion({
      model: "gpt-mock",
      systemPrompt: "sys",
      userPrompt: "usr",
    });

    assert.ok(scope.isDone());
    assert.strictEqual(resp.content, '{"test":"ok"}');
  });

  await t.test("Gemini request timeout rejects a slow provider operation", async () => {
    (config as any).AI_PROVIDER = "gemini";
    (config as any).GEMINI_API_KEY = "mock-gemini";
    nock("https://generativelanguage.googleapis.com")
      .post("/v1beta/models/gemini-mock:generateContent")
      .delay(100)
      .reply(200, { candidates: [{ content: { parts: [{ text: '{"test":"late"}' }] }, finishReason: "STOP" }] });

    await assert.rejects(
      generateStructuredCompletion({ model: "gemini-mock", systemPrompt: "sys", userPrompt: "usr", timeoutMs: 10 }),
      (error: any) => error?.name === "ProviderTimeoutError",
    );
    nock.cleanAll();
  });

  await t.test("Gemini-only mode blocks explicit OpenAI fallback requests", async () => {
    process.env.AI_PROVIDER_MODE = "gemini-only";
    (config as any).AI_PROVIDER = "gemini";
    await assert.rejects(
      generateStructuredCompletion({ model: "gpt-mock", systemPrompt: "sys", userPrompt: "usr", providerOverride: "openai" }),
      (error: any) => error?.name === "ProviderPolicyError",
    );
  });

  await t.test("Provider failures preserve billing and model-not-found classifications", async () => {
    assert.equal(classifyProviderFailure(new Error("429 You have no credits remaining")), "no_credits");
    assert.equal(classifyProviderFailure(Object.assign(new Error("model not found"), { status: 404 })), "model_not_found");
    assert.equal(classifyProviderFailure(Object.assign(new Error("unauthorized"), { status: 401 })), "auth_error");
  });

  await t.test("Provider modes expose explicit primary and fallback policy", async () => {
    process.env.AI_PROVIDER_MODE = "gemini-only";
    assert.deepStrictEqual(getAIProviderPolicy(), { mode: "gemini-only", primaryProvider: "gemini", fallbackProviders: [], fallbackAllowed: false });
    process.env.AI_PROVIDER_MODE = "openai-only";
    assert.deepStrictEqual(getAIProviderPolicy(), { mode: "openai-only", primaryProvider: "openai", fallbackProviders: [], fallbackAllowed: false });
  });

  await t.test("Gemini-only mode resolves router model to Gemini defaults", async () => {
    process.env.AI_PROVIDER_MODE = "gemini-only";
    const resolved = resolveModelForRole("router", "gpt-4.1-mini");
    assert.deepStrictEqual(resolved, { provider: "gemini", model: config.GEMINI_ROUTER_MODEL });
  });

  await t.test("OpenAI-only mode resolves router model to OpenAI defaults", async () => {
    process.env.AI_PROVIDER_MODE = "openai-only";
    const resolved = resolveModelForRole("router", "gemini-2.5-flash");
    assert.deepStrictEqual(resolved, { provider: "openai", model: config.OPENAI_ROUTER_MODEL });
  });
});
