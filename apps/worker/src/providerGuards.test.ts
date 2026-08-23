import test from "node:test";
import assert from "node:assert";
import { config } from "./config.js";
import { callRevisitSpotter } from "./openai.js";
// scriptSummary is not exported in a way we can easily test just the generator early return since it's an internal function.
// Actually, generateScriptSummaryInternal is not exported. But we can test `isActiveAIProviderConfigured()` and `callRevisitSpotter`.
import { isActiveAIProviderConfigured } from "./aiClient.js";

test("Provider Guards Behavior", async (t) => {
  const originalProvider = config.AI_PROVIDER;
  const originalOpenAI = config.OPENAI_API_KEY;
  const originalGemini = config.GEMINI_API_KEY;

  t.afterEach(() => {
    (config as any).AI_PROVIDER = originalProvider;
    (config as any).OPENAI_API_KEY = originalOpenAI;
    (config as any).GEMINI_API_KEY = originalGemini;
  });

  await t.test(
    "1. AI_PROVIDER=openai + valid OpenAI configuration -> stage is eligible",
    async () => {
      (config as any).AI_PROVIDER = "openai";
      (config as any).OPENAI_API_KEY = "valid-key";
      (config as any).GEMINI_API_KEY = "";
      assert.strictEqual(isActiveAIProviderConfigured(), true);
    },
  );

  await t.test(
    "2. AI_PROVIDER=gemini + valid Gemini configuration -> stage is eligible",
    async () => {
      (config as any).AI_PROVIDER = "gemini";
      (config as any).OPENAI_API_KEY = ""; // Even if OpenAI is missing!
      (config as any).GEMINI_API_KEY = "valid-key";
      assert.strictEqual(isActiveAIProviderConfigured(), true);
    },
  );

  await t.test(
    "3. Missing required active-provider configuration -> stage is rejected/skipped",
    async () => {
      // Gemini active, but key missing
      (config as any).AI_PROVIDER = "gemini";
      (config as any).GEMINI_API_KEY = "";
      (config as any).OPENAI_API_KEY = "valid-key"; // Has OpenAI key, but it shouldn't matter!
      assert.strictEqual(isActiveAIProviderConfigured(), false);

      // Test Revisit Spotter early return
      const resultGemini = await callRevisitSpotter("Some valid text", [
        "term",
      ]);
      assert.deepStrictEqual(
        resultGemini,
        [],
        "Should return early when active provider key is missing",
      );

      // OpenAI active, but key missing
      (config as any).AI_PROVIDER = "openai";
      (config as any).OPENAI_API_KEY = "";
      (config as any).GEMINI_API_KEY = "valid-key"; // Has Gemini key, shouldn't matter!
      assert.strictEqual(isActiveAIProviderConfigured(), false);

      const resultOpenAI = await callRevisitSpotter("Some valid text", [
        "term",
      ]);
      assert.deepStrictEqual(
        resultOpenAI,
        [],
        "Should return early when active provider key is missing",
      );
    },
  );

  await t.test(
    "4. Existing text/terms empty checks retain their current behavior",
    async () => {
      (config as any).AI_PROVIDER = "openai";
      (config as any).OPENAI_API_KEY = "valid-key";

      const noTerms = await callRevisitSpotter("Some valid text", []);
      assert.deepStrictEqual(noTerms, [], "Should return early on empty terms");

      const noText = await callRevisitSpotter("   ", ["term"]);
      assert.deepStrictEqual(noText, [], "Should return early on empty text");
    },
  );
});
