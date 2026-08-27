import { callJudgeRaw } from './src/openai.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  const articlePath = path.join(__dirname, '../../reviewers/v5/article_02_state_leadership.md');
  const promptText = fs.readFileSync(articlePath, 'utf8');
  
  const chunkText = `
المشهد الأول
الزمان: نهاراً
المكان: مقهى شعبي في وسط المدينة

(يجلس أحمد مع صديقه خالد، يبدو على أحمد التوتر الشديد)
أحمد: (بصوت منخفض) والله العظيم يا خالد لو شفته تاني في الحارة لأكسر رجله وأخليه عبرة لمن لا يعتبر.
خالد: اهدأ يا رجل، لا تضيع مستقبلك عشان واحد تافه، هو بس بيستفزك.
أحمد: يستفزني؟ ده دخل بيتي وسرق فلوسي، والآن بينشر صوري الخاصة على الإنترنت ليبتزني! أنا مش هسكت.
(يضرب أحمد الطاولة بيده بقوة، يلتفت إليهم بعض الزبائن)
خالد: طيب، خلينا نبلغ الشرطة، هم يتصرفوا معاه.
أحمد: شرطة إيه؟ أنا هاخد حقي بيدي، واللي يحصل يحصل.
  `.trim();

  const article = {
    id: 2,
    title_ar: "الإساءة للقيادة",
    text_ar: promptText,
    atoms: []
  };

  const jobConfig = {
    judge_model: 'gemini-2.5-pro',
    temperature: 0,
    seed: 42
  };

  console.log("Running Article 02 specific test for token usage...");
  const start = Date.now();
  const resp = await callJudgeRaw(chunkText, [article as any], 0, chunkText.length, jobConfig, promptText, null, {});
  const duration = Date.now() - start;

  console.log("\n--- RESULT ---");
  console.log("Duration:", duration, "ms");
  console.log("Finish Reason:", resp.finish_reason);
  console.log("Usage:", resp.usage);
  console.log("Raw Response Length:", resp.raw_judge_response.length);
  console.log("Raw Response Snippet:", resp.raw_judge_response.substring(0, 200));
}

runTest().catch(console.error);
