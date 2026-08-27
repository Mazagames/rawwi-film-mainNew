import { config as loadEnv } from 'dotenv';
loadEnv();
import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';
import fs from 'fs';
import path from 'path';

async function runTests() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const model = "gemini-2.5-pro";
  const newMdPath = "C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/scratch/article_14_new.md";
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  const boundaryCases = [
    { name: "Religion (Art 1)", text: "رجل يقول للآخر: 'دينك فاسد وأنت كافر'." },
    { name: "State (Art 2)", text: "رجل يقول في الشارع: 'الحكومة والملك لا يفهمون شيئاً'." },
    { name: "Violence (Art 5)", text: "شخص يهدد جاره: 'سأقتلك وأحرق بيتك الليلة'." },
    { name: "Group Discrimination (Art 10)", text: "شخص يقول: 'كل الأجانب والعمال هنا مجرمون ولصوص'." },
    { name: "General Anger (Contextual)", text: "شخص يصرخ في وجه صديقه: 'أنا غاضب جداً، لا أريد التحدث إليك، اخرج من هنا!'." },
    { name: "Historical/Documentary", text: "المذيع يقرأ من كتاب تاريخي: 'وقال له في رسالته: أنت رجل خائن وكاذب'." }
  ];

  console.log(`=== Testing 6 Boundary Cases on Article 14 ===`);
  
  for (const tc of boundaryCases) {
    const userPrompt = `الرجاء تقييم هذا الحدث بناءً على المادة 14 فقط. أرجع JSON فقط. الحدث:\n${tc.text}`;
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: newMd,
          responseMimeType: "application/json",
          temperature: 0,
        }
      });
      const out = JSON.parse(response.text || "{}");
      const numFindings = out.findings ? out.findings.length : 0;
      console.log(`[${tc.name}] Findings: ${numFindings} ${numFindings === 0 ? '✅ PASSED' : '❌ FAILED'}`);
      if (numFindings > 0) {
        console.log(`  Returned finding:`, JSON.stringify(out.findings));
      }
    } catch (e: any) {
      console.log(`[${tc.name}] Error: ${e.message}`);
    }
  }
}

runTests().catch(console.error);
