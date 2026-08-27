import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';

async function testThinking() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  console.log("Testing gemini-2.5-pro with thinkingBudget: 128 and JSON mode...");
  
  const startTime = Date.now();
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: 'What is the meaning of life? Output JSON with key "meaning".',
    config: {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 128 }
    }
  });
  
  console.log(`Duration: ${Date.now() - startTime}ms`);
  console.log(`Finish Reason: ${response.candidates?.[0]?.finishReason}`);
  console.log(`Total Tokens: ${response.usageMetadata?.totalTokenCount}`);
  console.log(`Prompt Tokens: ${response.usageMetadata?.promptTokenCount}`);
  console.log(`Candidates Token Count: ${response.usageMetadata?.candidatesTokenCount}`);
  console.log(`Thoughts Tokens: ${(response.usageMetadata as any)?.thoughtsTokenCount || 'N/A'}`);
  console.log(`Text: ${response.text?.slice(0, 100)}...`);
}

testThinking().catch(console.error);
