import { runMultiPassDetection } from './src/multiPassJudge.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const text = `
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

  // Load real GCAM articles
  const articleDir = path.join(__dirname, '../../reviewers/v5');
  const files = fs.readdirSync(articleDir).filter(f => f.startsWith('article_'));
  const allArticles = [];
  for (const f of files) {
    if (f.endsWith('.md')) {
      const content = fs.readFileSync(path.join(articleDir, f), 'utf8');
      const articleIdMatch = content.match(/article_id:\s*(\d+)/);
      const articleId = articleIdMatch ? parseInt(articleIdMatch[1], 10) : 0;
      allArticles.push({
        id: articleId,
        title_ar: f.replace('.md', ''),
        text_ar: content,
        atoms: []
      });
    }
  }

  console.log("Running real multi-pass detection on small script...");
  
  const start = Date.now();
  const results = await runMultiPassDetection(
    text,
    0,
    text.length,
    allArticles,
    [], // terms
    { temperature: 0, seed: 123 },
    { chunkId: 'test_chunk_001' }
  );
  const duration = Date.now() - start;

  console.log("\n=== TEST RESULTS ===");
  console.log("Total Duration:", duration, "ms");
  console.log("Executed Passes:", results.executedPassCount);
  console.log("Skipped Passes:", results.skippedPassCount);
  console.log("Total Findings Count:", results.findings.length);

  // Print findings
  console.log("\nFindings:");
  results.findings.forEach((f, i) => {
    console.log(`\n[Finding ${i+1}] ${f.title_ar}`);
    console.log(`Article: ${f.article_id}, Pass: ${f.detection_pass}, Atom: ${f.canonical_atom}`);
    console.log(`Evidence: "${f.evidence_snippet}"`);
  });
}

run().catch(console.error);
