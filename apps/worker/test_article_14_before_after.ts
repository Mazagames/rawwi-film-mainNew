import { config as loadEnv } from 'dotenv';
loadEnv();
import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const model = "gemini-2.5-pro";

  const oldMdPath = path.join(__dirname, "..", "..", "reviewers", "v5", "article_14_profanity_personal_insults.md");
  const newMdPath = "C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/scratch/article_14_new.md";

  const oldMd = fs.readFileSync(oldMdPath, "utf-8");
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  console.log(`Old MD Characters: ${oldMd.length}`);
  console.log(`New MD Characters: ${newMd.length}`);

  const eventText = `
المقطع يبدأ:
رجل يقول للآخر: "أنت إنسان غبي وحقير، ولا تفهم شيئاً."
الآخر يرد: "اغرب عن وجهي يا أحمق."
المقطع ينتهي.
  `;

  const userPrompt = `
  الرجاء تقييم هذا الحدث:
  ${eventText}
  
  قواعد الإخراج:
  أرجع JSON يحتوي على مصفوفة findings، كل عنصر فيه: 
  article_id, title_ar, description_ar, evidence_snippet.
  `;

  async function testPrompt(name: string, systemInstruction: string) {
    console.log(`\n=== Testing ${name} ===`);
    const startTime = Date.now();
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
      const usage = response.usageMetadata;
      console.log(`Tokens - In: ${usage?.promptTokenCount}, Out: ${usage?.candidatesTokenCount}, Thoughts: ${(usage as any)?.thoughtsTokenCount || 0}`);
      console.log(`Duration: ${Date.now() - startTime}ms`);
      console.log(`Output: ${response.text?.trim()}`);
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  }

  await testPrompt("OLD PROMPT", oldMd);
  await testPrompt("NEW PROMPT", newMd);
}

runTest().catch(console.error);
