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

  const oldMdPath = path.join(__dirname, "test_art17_old.md");
  const newMdPath = "C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/scratch/article_17_new.md";

  const oldMd = fs.readFileSync(oldMdPath, "utf-8");
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  console.log(`Old MD Characters: ${oldMd.length}`);
  console.log(`New MD Characters: ${newMd.length}`);

  const boundaryCases = [
    { 
      name: "1. defamation/privacy violation", 
      text: "رجل يقول لامرأة: 'سأنشر صورك الخاصة التي أرسلتها لي وأفضحك أمام عائلتك وأصدقائك في كل مكان.'",
      expected: 1
    },
    { 
      name: "2. blackmail with secrets", 
      text: "شخص يقول لمديره: 'إذا لم تقم بترقيتي غداً، سأعطي الصحافة الملفات السرية التي تدينك بالاختلاس.'",
      expected: 1
    },
    { 
      name: "3. mere insult (Art 14 territory)", 
      text: "رجل يصرخ في وجه جاره: 'أنت غبي وأحمق ومغفل!'",
      expected: 0
    },
    { 
      name: "4. legal/judicial context", 
      text: "القاضي يقرأ في المحكمة: 'المتهم قام بتسريب صور المدعية، وهذا يعتبر جريمة يعاقب عليها القانون.'",
      expected: 0
    },
    { 
      name: "5. state/leadership defamation (Art 2)", 
      text: "شخص في الشارع يصرخ: 'الملك ظالم والحكومة تسرق أموالنا.'",
      expected: 0
    },
    { 
      name: "6. mentioning privacy terms without violation", 
      text: "يقول البطل لصديقه: 'يجب أن تحافظ على خصوصية رسائلك وصورك ولا ترسلها لأحد غريب.'",
      expected: 0
    }
  ];

  console.log(`\n=== Testing 6 Regression Cases on Article 17 ===`);
  
  for (const tc of boundaryCases) {
    const userPrompt = `الرجاء تقييم هذا الحدث بناءً على المادة 17 فقط. أرجع JSON فقط يحتوي على findings. الحدث:\n${tc.text}`;
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: newMd, // Test new prompt only for regression
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
      const rawText = response.text?.trim() || "{}";
      let out: any = {};
      try { out = JSON.parse(rawText); } catch { out = {}; }
      // Normalise: top-level array OR { findings: [...] } OR { finding: {...} }
      let findings: any[] = [];
      if (Array.isArray(out)) findings = out;
      else if (Array.isArray(out.findings)) findings = out.findings;
      else if (out.findings) findings = [out.findings];
      const numFindings = findings.length;
      const passed = numFindings === tc.expected;
      console.log(`[${tc.name}] Expected: ${tc.expected}, Got: ${numFindings} ${passed ? '✅ PASSED' : '❌ FAILED'}`);
      if (!passed) {
        console.log(`  Raw response: ${rawText.substring(0, 300)}`);
      }
      if (tc.expected > 0 && numFindings > 0) {
        console.log(`  Findings Details:`, JSON.stringify(findings));
      }
    } catch (e: any) {
      console.log(`[${tc.name}] Error: ${e.message}`);
    }
  }

  const eventText = `
المقطع يبدأ:
رجل يقول لامرأة: "سأنشر صورك الخاصة التي أرسلتها لي وأفضحك أمام عائلتك وأصدقائك في كل مكان."
المرأة ترد: "أرجوك لا تفعل ذلك."
المقطع ينتهي.
  `;

  const comparePrompt = `
  الرجاء تقييم هذا الحدث:
  ${eventText}
  
  قواعد الإخراج:
  أرجع JSON يحتوي على مصفوفة findings، كل عنصر فيه: 
  article_id, title_ar, description_ar, evidence_snippet.
  `;

  async function testCompare(name: string, systemInstruction: string) {
    console.log(`\n=== Testing ${name} ===`);
    const startTime = Date.now();
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: comparePrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
      const usage = response.usageMetadata;
      console.log(`Tokens - In: ${usage?.promptTokenCount}, Out: ${usage?.candidatesTokenCount}, Thoughts: ${(usage as any)?.thoughtsTokenCount || 0}`);
      console.log(`Duration: ${Date.now() - startTime}ms`);
      // console.log(`Output: ${response.text?.trim()}`);
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  }

  await testCompare("OLD PROMPT", oldMd);
  await testCompare("NEW PROMPT", newMd);
}

runTest().catch(console.error);
