import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';

async function testMaxTokens() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  console.log("Testing MAX_TOKENS...");
  
  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: 'Write a 1000 page essay about the meaning of life, including complex json structures.',
      config: {
        maxOutputTokens: 2,
        thinkingConfig: { thinkingBudget: 1024 }
      }
    });
    console.log(JSON.stringify(response, null, 2));
  } catch (err) {
    console.error(err);
  }
}

testMaxTokens().catch(console.error);
