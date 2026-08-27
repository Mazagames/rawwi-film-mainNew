import { callJudgeRaw } from './src/openai.js';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  const articlePath = path.join(__dirname, '../../reviewers/v5/article_17_dignity_reputation_privacy.md');
  const promptText = fs.readFileSync(articlePath, 'utf8');
  
  const chunkText = "المشهد الداخلي، نهاراً: يقوم الرجل بتصوير المرأة خلسة وهي في غرفة تبديل الملابس بهدف ابتزازها لاحقاً ونشر صورها على الإنترنت إذا لم تدفع له مبلغاً مالياً كبيراً.";
  const article = {
    id: 17,
    title_ar: "الكرامة والسمعة والخصوصية",
    text_ar: "يمنع التشهير أو انتهاك الخصوصية أو الابتزاز",
    atoms: []
  };

  const jobConfig = {
    judge_model: 'gemini-2.5-pro',
    temperature: 0,
    seed: 42
  };

  console.log("Running Article 17 test...");
  const start = Date.now();
  const resp = await callJudgeRaw(chunkText, [article as any], 0, 100, jobConfig, promptText, null, {});
  const duration = Date.now() - start;

  console.log("\n--- RESULT ---");
  console.log("Duration:", duration, "ms");
  console.log("Finish Reason:", resp.finish_reason);
  console.log("Usage:", resp.usage);
  console.log("Raw Response Length:", resp.raw_judge_response.length);
  console.log("Raw Response Snippet:", resp.raw_judge_response.substring(0, 200));
}

runTest().catch(console.error);
