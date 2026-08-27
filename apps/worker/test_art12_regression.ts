import { config as loadEnv } from 'dotenv';
loadEnv();
import { GoogleGenAI } from '@google/genai';
import { config } from './src/config.js';
import fs from 'fs';

async function runTests() {
  const gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const model = "gemini-2.5-pro";
  const newMdPath = "d:/Waheed/MypProjects/raawi emergency/rawwi-film-mainNew/reviewers/v5/article_12_child_protection_exploitation.md";
  const newMd = fs.readFileSync(newMdPath, "utf-8");

  const boundaryCases = [
    { 
      name: "1. child exploitation/criminal use", 
      text: "رجل عصابة يقول لطفل في العاشرة: 'اذهب واسرق تلك السيارة الآن وإلا عاقبتك.'",
      expected: 1
    },
    { 
      name: "2. physical abuse of child", 
      text: "الأب يضرب ابنه الصغير بعنف بحزام جلدي لدرجة الإدماء بسبب تأخره.",
      expected: 1
    },
    { 
      name: "3. sexual exploitation/trafficking", 
      text: "عصابة تقوم باختطاف فتاة صغيرة لبيعها في سوق مظلم للأعمال المنافية للآداب.",
      expected: 1
    },
    { 
      name: "4. child merely present in scene", 
      text: "الأسرة تتناول طعام العشاء في صمت بينما يجلس طفلهم الصغير يلعب بلعبته في الزاوية.",
      expected: 0
    },
    { 
      name: "5. adult-only violence", 
      text: "شجار عنيف ينشب بين رجلين في المقهى، أحدهما يضرب الآخر بزجاجة.",
      expected: 0
    },
    { 
      name: "6. report/news condemning abuse", 
      text: "مذيعة الأخبار تقول: 'الشرطة ألقت القبض على شبكة تعذب الأطفال، ونحن ندين هذه الأفعال الشنيعة التي تدمر طفولتهم.'",
      expected: 0
    },
    { 
      name: "7. mention of words without actual child exploitation", 
      text: "رجل يقول لصديقه: 'الدعارة والشحاذة والخطف جرائم سيئة يجب القضاء عليها تماماً في مجتمعنا.'",
      expected: 0
    },
    { 
      name: "8. dangerous child situation", 
      text: "أب يترك طفله الرضيع على حافة نافذة مفتوحة بالطابق العاشر ويغادر الشقة.",
      expected: 1
    },
    { 
      name: "9. actual depicted child abuse (drama)", 
      text: "فهد يصفع ابنه سامي بقوة على وجهه قائلاً: أنت سبب كل شيء، لو ما كنت فاشل ما صار اللي صار.",
      expected: 1
    },
    { 
      name: "10. past abuse reported without being shown", 
      text: "الضابط ينظر إلى الملف ويقول: القضية واضحة، تعرض الطفل لضرب مبرح قبل ثلاث سنوات.",
      expected: 0
    }
  ];

  console.log(`=== Testing 8 Regression Cases on Article 12 ===`);
  
  for (const tc of boundaryCases) {
    const userPrompt = `الرجاء تقييم هذا الحدث بناءً على المادة 12 فقط. أرجع JSON فقط يحتوي على findings. الحدث:\n${tc.text}`;
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
      const passed = numFindings === tc.expected;
      console.log(`[${tc.name}] Expected: ${tc.expected}, Got: ${numFindings} ${passed ? '✅ PASSED' : '❌ FAILED'}`);
      if (!passed || tc.expected > 0) {
        console.log(`  Findings Details:`, JSON.stringify(out.findings));
      }
    } catch (e: any) {
      console.log(`[${tc.name}] Error: ${e.message}`);
    }
  }
}

runTests().catch(console.error);
