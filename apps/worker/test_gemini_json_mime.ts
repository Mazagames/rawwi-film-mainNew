import { config as loadEnv } from 'dotenv';
loadEnv();
import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';
import fs from 'fs';

async function testGemini(articleTitle: string, userPrompt: string, useJsonMime: boolean, maxTokens: number, thinkingBudget: number) {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const model = "gemini-2.5-pro";
  
  const systemPrompt = `You are an expert content moderator.
Analyze the following text against ${articleTitle}.
Return a JSON object containing a 'findings' array. Each finding must include a detailed rationale.`;

  console.log(`\n=== Testing ${articleTitle} (JSON Mime: ${useJsonMime}) ===`);
  const reqConfig: any = {
    systemInstruction: systemPrompt,
    temperature: 0,
    maxOutputTokens: maxTokens,
  };
  
  if (useJsonMime) {
    reqConfig.responseMimeType = "application/json";
  }
  
  if (thinkingBudget) {
    reqConfig.thinkingConfig = { thinkingBudget };
  }

  const startTime = Date.now();
  let result = null;
  try {
    const response = await gemini.models.generateContent({
      model,
      contents: userPrompt,
      config: reqConfig,
    });
    const usage = response.usageMetadata;
    const thoughts = (usage as any)?.thoughtsTokenCount || 0;
    const finishReason = response.candidates?.[0]?.finishReason;
    
    console.log(`Success! FinishReason: ${finishReason}`);
    console.log(`Tokens: In ${usage?.promptTokenCount}, Out ${usage?.candidatesTokenCount}, Thoughts ${thoughts}`);
    console.log(`Duration: ${Date.now() - startTime}ms`);
  } catch (err: any) {
    console.log(`Error: ${err.message}`);
    console.log(err.stack);
  }
}

async function run() {
  const prompt = "The text to analyze is: 'You are an idiot and I hate you.'".repeat(100);
  
  await testGemini("Article 14 (Insults)", prompt, true, 32768, 16384);
  await testGemini("Article 14 (Insults)", prompt, false, 32768, 16384);
}

run().catch(console.error);
