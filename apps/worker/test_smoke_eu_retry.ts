import 'dotenv/config';
import { buildEventUnderstandingPass } from './src/eventUnderstanding.js';
import { config } from './src/config.js';

async function run() {
  console.log("=== REGRESSION TEST: Event Understanding Retry & Fallback ===");

  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let openaiCalls = 0;

  globalThis.fetch = async (url: any, options: any) => {
    if (url.toString().includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      // Simulate 503 UNAVAILABLE on the first two calls
      if (geminiCalls <= 3) {
        console.log(`[Mock] Gemini Call ${geminiCalls}: Returning 503`);
        return new Response(JSON.stringify({
          error: {
            code: 503,
            message: "The model is overloaded. Please try again later.",
            status: "UNAVAILABLE"
          }
        }), { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "application/json" }});
      } else {
        // We shouldn't reach here if maxAttempts is 3 and it falls back, but let's say it falls back after 3 attempts?
        // Wait, the logic I wrote falls back if it's Gemini AND attempts < maxAttempts fails.
        // Wait, if attempts == maxAttempts (3), it breaks out of the loop? No, my logic says:
        // if (is503 && attempts < maxAttempts) { sleep; continue; }
        // So on attempt 1, it sleeps. On attempt 2, it sleeps. On attempt 3, it does NOT sleep!
        // It proceeds to: if (provider === "gemini") { provider = "openai"; ... }
        // So it falls back on attempt 3!
        console.log(`[Mock] Gemini Call ${geminiCalls}: Returning success`);
        return new Response(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ chunk_start: 0, chunk_end: 10, event_count: 1, events: [{ event_id: 1, event_summary: "Test", actor: "A", action: "B", intent: "C", consequence: "D", quote: "E", start_offset: 0, end_offset: 10, dominant_meaning: "F" }] }) }] },
            finishReason: "STOP"
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
        }), { status: 200, headers: { "Content-Type": "application/json" }});
      }
    } else if (url.toString().includes('api.openai.com')) {
      openaiCalls++;
      console.log(`[Mock] OpenAI Call ${openaiCalls}: Returning success`);
      return new Response(JSON.stringify({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4-turbo",
        choices: [{
          index: 0,
          message: { role: "assistant", content: JSON.stringify({ chunk_start: 0, chunk_end: 10, event_count: 1, events: [{ event_id: 1, event_summary: "Test", actor: "A", action: "B", intent: "C", consequence: "D", quote: "E" }] }) },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    return originalFetch(url, options);
  };

  try {
    config.AI_PROVIDER = "gemini";
    config.GEMINI_API_KEY = "mock_key";
    config.OPENAI_API_KEY = "mock_key";
    
    // Scenario 1: Gemini succeeds on first try
    console.log("\n--- Scenario 1: Gemini Success ---");
    geminiCalls = 3; // skip the 503s
    openaiCalls = 0;
    await buildEventUnderstandingPass("Test chunk", 0, 10);
    console.log(`Gemini calls: ${geminiCalls - 3}, OpenAI calls: ${openaiCalls}`);
    if (openaiCalls > 0) throw new Error("OpenAI should not be called if Gemini succeeds");

    // Scenario 2: Gemini 503 -> retry -> 503 -> fallback to OpenAI
    console.log("\n--- Scenario 2: Gemini 503 -> Retry -> Fallback ---");
    geminiCalls = 0;
    openaiCalls = 0;
    await buildEventUnderstandingPass("Test chunk", 0, 10);
    console.log(`Gemini calls: ${geminiCalls}, OpenAI calls: ${openaiCalls}`);
    if (geminiCalls !== 4) throw new Error(`Expected 4 Gemini calls (3 for extraction + 1 for verification), got ${geminiCalls}`);
    if (openaiCalls !== 1) throw new Error(`Expected 1 OpenAI call (1 fallback for extraction), got ${openaiCalls}`);

    console.log("\nALL TESTS PASSED");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch(console.error);
