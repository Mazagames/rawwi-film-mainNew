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
  const oldMdPath = path.join(__dirname, "test_art05_old.md");
  const newMdPath = "C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/scratch/article_05_new.md";
  const oldMd = fs.readFileSync(oldMdPath, "utf-8");
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  console.log(`Old MD Characters: ${oldMd.length}`);
  console.log(`New MD Characters: ${newMd.length}`);

  const regressionCases = [
    { name: "1. brutal murder order (violation)", text: "زعيم العصابة يقول: 'اذبحه واقطع رأسه وارم الجثة في البحر.'", expected: 1 },
    { name: "2. torture order (violation)", text: "رجل يأمر جنوده: 'عذبوه حتى يعترف، اكووه واسحبوا أظافره، لا تتركوه ينام.'", expected: 1 },
    { name: "3. body disposal (violation)", text: "شخص يقول: 'أذب الجثة بالأسيد وضع الباقي في أكياس واختفي.'", expected: 1 },
    { name: "4. incitement/glorification (violation)", text: "شخص يقول: 'القتل الوحيد الصحيح هو بقر البطن وسحب الأمعاء، هكذا تتعلم الدرس.'", expected: 1 },
    { name: "5. regular fight no brutality (no violation)", text: "رجلان يتشاجران في الشارع، أحدهما يلكم الآخر ويتركه على الأرض.", expected: 0 },
    { name: "6. dramatic narration/no glorification (no violation)", text: "المحقق يصف مشهد الجريمة: 'وجدنا الجثة في المستودع، وكانت قد تعرضت للتعذيب قبل الوفاة.'", expected: 0 },
    { name: "7. historical/war context (no violation)", text: "المؤرخ يروي: 'في معركة عام 1900، استخدم الغزاة أساليب تعذيب وحشية، مما أودى بحياة الآلاف.'", expected: 0 },
    { name: "8. indirect threat without kill confirmation (no violation)", text: "مدير يقول لموظف: 'إذا كشفت سري، سأصفي حسابك معك وستندم.' الموظف يغادر خائفاً.", expected: 0 },
  ];

  console.log(`\n=== Regression (NEW PROMPT) ===`);
  for (const tc of regressionCases) {
    const userPrompt = `الرجاء تقييم هذا الحدث بناءً على المادة 05 فقط. أرجع JSON فقط يحتوي على findings. الحدث:\n${tc.text}`;
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
  const testCase = "زعيم يأمر أعضاء العصابة: 'هذه الليلة نصفّيه. اقطع رأسه واذب الجثة بالأسيد. أريد أن تختفي أي دليل.'";
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
