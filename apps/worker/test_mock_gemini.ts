import { generateStructuredCompletion } from "./src/aiClient.js";
import { config } from "./src/config.js";
import nock from "nock";

async function runTests() {
  // Test 4: Mocked Gemini Flash Event Understanding request
  config.AI_PROVIDER = "gemini";
  config.GEMINI_API_KEY = "mock-key";
  
  let capturedGeminiFlashReq: any = null;
  nock("https://generativelanguage.googleapis.com")
    .post("/v1beta/models/gemini-2.5-flash:generateContent")
    .reply(200, (uri, requestBody) => {
      capturedGeminiFlashReq = requestBody;
      return { candidates: [{ finishReason: "STOP", content: { parts: [{text: "{}"}] } }], usageMetadata: {} };
    });

  await generateStructuredCompletion({
    model: "gemini-2.5-flash",
    systemPrompt: "sys",
    userPrompt: "usr",
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    thinkingBudget: 0,
  });

  console.log("Flash Request Thinking Config:", capturedGeminiFlashReq.generationConfig?.thinkingConfig);
  console.log("Flash Request Max Tokens:", capturedGeminiFlashReq.generationConfig?.maxOutputTokens);
  
  // Test 5: Mocked Gemini Pro Judge request
  let capturedGeminiProReq: any = null;
  nock("https://generativelanguage.googleapis.com")
    .post("/v1beta/models/gemini-2.5-pro:generateContent")
    .reply(200, (uri, requestBody) => {
      capturedGeminiProReq = requestBody;
      return { candidates: [{ finishReason: "STOP", content: { parts: [{text: "{}"}] } }], usageMetadata: {} };
    });

  await generateStructuredCompletion({
    model: "gemini-2.5-pro",
    systemPrompt: "sys",
    userPrompt: "usr",
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    // NO thinkingBudget
  });

  console.log("Pro Request Thinking Config:", capturedGeminiProReq.generationConfig?.thinkingConfig);
  
  // Test 6: Mocked OpenAI request
  config.AI_PROVIDER = "openai";
  config.OPENAI_API_KEY = "mock-openai";
  
  let capturedOpenAIReq: any = null;
  nock("https://api.openai.com")
    .post("/v1/chat/completions")
    .reply(200, (uri, requestBody) => {
      capturedOpenAIReq = requestBody;
      return { choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: {} };
    });

  await generateStructuredCompletion({
    model: "gpt-4.1",
    systemPrompt: "sys",
    userPrompt: "usr",
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    thinkingBudget: 0, // Ignored by OpenAI adapter!
  });

  console.log("OpenAI Request Max Tokens:", capturedOpenAIReq.max_completion_tokens);
  console.log("OpenAI Request Has Thinking Budget?:", 'thinkingBudget' in capturedOpenAIReq);
  
}

runTests().catch(console.error);
