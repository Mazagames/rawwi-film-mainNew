import { config as loadEnv } from 'dotenv';
loadEnv();
import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseFindings(text: string): any[] {
  let out: any = {};
  try { out = JSON.parse(text || "{}"); } catch { out = {}; }
  if (Array.isArray(out)) return out;
  if (Array.isArray(out.findings)) return out.findings;
  if (out.findings) return [out.findings];
  return [];
}

async function runTests() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const model = "gemini-2.5-pro";
  const oldMdPath = path.join(__dirname, "test_art10_old.md");
  const newMdPath = "C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/scratch/article_10_new.md";
  const oldMd = fs.readFileSync(oldMdPath, "utf-8");
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  console.log(`Old MD Characters: ${oldMd.length}`);
  console.log(`New MD Characters: ${newMd.length}`);

  const regressionCases = [
    { name: "1. explicit hate speech against group", text: "مواطن يقول: 'كل هؤلاء الأجانب حشرات، يجب أن نطردهم من بلدنا، وجودهم خراب.'", expected: 1 },
    { name: "2. dehumanizing a tribe", text: "شخص يقول: 'أفراد قبيلة كذا مجرد عبيد ولا يستحقون العيش معنا.'", expected: 1 },
    { name: "3. individual insult (Art 14 territory, NOT 10)", text: "رجل يقول لجاره في شجار: 'أنت غبي وحيوان ولا تفهم شيئاً.'", expected: 0 },
    { name: "4. political criticism", text: "سياسي ينتقد الحكومة: 'السياسات الاقتصادية الحالية فاشلة وأدت إلى الفساد.'", expected: 0 },
    { name: "5. character facing hate speech to condemn it", text: "المعلم يقول للطلاب: 'من المعيب أن نقول أن لون بشرتهم يجعلهم أقل منا، هذا تمييز مقيت.'", expected: 0 },
    { name: "6. general swearing not targeting identity", text: "لص غاضب يصرخ: 'تباً لكم جميعاً، سأنتقم منكم.'", expected: 0 },
  ];

  console.log(`\n=== Regression (NEW PROMPT) ===`);
  for (const tc of regressionCases) {
    const userPrompt = `الرجاء تقييم هذا الحدث بناءً على المادة 10 فقط. أرجع JSON فقط يحتوي على findings. الحدث:\n${tc.text}`;
    try {
      const response = await gemini.models.generateContent({
        model, contents: userPrompt,
        config: { systemInstruction: newMd, responseMimeType: "application/json", temperature: 0 }
      });
      const findings = parseFindings(response.text?.trim() || "{}");
      const passed = findings.length === tc.expected;
      console.log(`[${tc.name}] Expected: ${tc.expected}, Got: ${findings.length} ${passed ? '✅' : '❌ FAILED'}`);
      if (!passed) console.log(`  Raw: ${response.text?.substring(0, 200)}`);
    } catch (e: any) { console.log(`[${tc.name}] Error: ${e.message}`); }
  }

  // Size/token comparison with a representative violation case
  const testCase = "مواطن يقول: 'كل المهاجرين الذين جاءوا إلى هنا أنجاس ومجرمون، يجب أن نغلق الحدود في وجوههم ونطردهم.'";
  const userPrompt = `تقييم: ${testCase}`;

  for (const [label, md] of [["OLD PROMPT", oldMd], ["NEW PROMPT", newMd]]) {
    console.log(`\n=== ${label} ===`);
    const start = Date.now();
    try {
      const response = await gemini.models.generateContent({
        model, contents: userPrompt,
        config: { systemInstruction: md, responseMimeType: "application/json", temperature: 0 }
      });
      const u = response.usageMetadata as any;
      console.log(`Tokens - In: ${u?.promptTokenCount}, Out: ${u?.candidatesTokenCount}, Thoughts: ${u?.thoughtsTokenCount || 0}`);
      console.log(`Duration: ${Date.now() - start}ms`);
    } catch (e: any) { console.log(`Error: ${e.message}`); }
  }
}

runTests().catch(console.error);
