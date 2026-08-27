import { callJudgeRaw } from './src/openai.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';

async function testRuntimeConfig() {
  console.log("Testing callJudgeRaw config...");
  try {
    const res = await callJudgeRaw(
      "Test chunk text",
      [{ article_id: 1, title_ar: "Test", description_ar: "Test", severity: "low", atom_id: "test", canonical_atom: "test" }],
      0,
      100,
      { judge_model: config.GEMINI_JUDGE_MODEL, temperature: 0.1, seed: 123, analysis_signature_context: null },
      "System prompt",
      "User prompt",
      { signal: undefined }
    );
    console.log("Success:", res.usage);
  } catch (err: any) {
    console.error("Error from callJudgeRaw:", err.message);
    if (err.usage) {
      console.log("Usage attached to error:", err.usage);
    }
  }
}

testRuntimeConfig().catch(console.error);
