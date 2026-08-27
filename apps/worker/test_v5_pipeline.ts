import { supabase } from './src/db.js';
import { runMultiPassDetection } from './src/multiPassJudge.js';
import { config } from './src/config.js';

async function runPipeline() {
  const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
  
  // Force mock string for fast deterministic test
  let chunkText = "المشهد الداخلي، نهاراً: يقوم الرجل بتصوير المرأة خلسة وهي في غرفة تبديل الملابس بهدف ابتزازها لاحقاً ونشر صورها على الإنترنت إذا لم تدفع له مبلغاً مالياً كبيراً.\n".repeat(50);
  
  console.log(`Running actual runMultiPassDetection on chunk length ${chunkText.length}...`);

  // Force only Article 17 pass by mocking config or passing a specific plan
  const mockArticles = [{
    id: 17,
    title_ar: "الكرامة والسمعة والخصوصية",
    text_ar: "يمنع التشهير",
    atoms: []
  }];
  
  const { DETECTION_PASSES } = await import('./src/multiPassJudge.js');
  const article17Pass = DETECTION_PASSES.find(p => p.name === 'v5_article_17');
  if (!article17Pass) throw new Error("Pass v5_article_17 not found");

  const mockPlan = {
    planVersion: "1.0",
    activePasses: [article17Pass],
    skippedPasses: []
  };

  const jobConfig = { judge_model: 'gemini-2.5-pro', temperature: 0, seed: 42, router_model: 'gpt-4o' };
  
  const res = await runMultiPassDetection(
    chunkText,
    0,
    chunkText.length,
    mockArticles as any,
    [], // lexiconTerms
    jobConfig as any,
    undefined, // progressOpts
    mockPlan as any, // executionPlan
  );

  console.log(`\n=== RAW PASS RESULTS ===`);
  console.log(JSON.stringify(res.passResults, null, 2));

  const finding = res.findings[0];
  if (!finding) {
    console.log("No finding produced!");
    return;
  }
  
  console.log(`\n=== FINDING DETAILS ===`);
  console.log(`passName: ${finding.detection_pass}`);
  console.log(`article_id: ${finding.article_id}`);
  console.log(`canonical_atom: ${finding.canonical_atom}`);
  console.log(`confidence: ${finding.confidence}`);
  console.log(`evidence: ${finding.evidence_snippet}`);
  console.log(`offsets: Start ${finding.location?.start_offset}, End ${finding.location?.end_offset}`);
  
  const isViolation = finding.article_id !== 0 && finding.article_id != null;
  
  // Validate finding
  const { groundFindingEvidenceToChunk } = await import('./src/evidenceGrounding.js');
  const groundedResult = groundFindingEvidenceToChunk(finding, String(chunkText), []);
  
  console.log(`\n=== PIPELINE RESULTS ===`);
  console.log(`raw Gemini finding: ${finding.finding_uuid} (${finding.detection_pass})`);
  console.log(`tagged finding: ${finding.title_ar}`);
  console.log(`final article_id: ${finding.article_id}`);
  console.log(`violation count: ${isViolation && groundedResult.grounded ? 1 : 0}`);
  console.log(`note count: ${!isViolation && groundedResult.grounded ? 1 : 0}`);
  console.log(`validator result: ${groundedResult.grounded ? 'PASSED' : 'REJECTED'}`);
  console.log(`persisted finding count: ${groundedResult.grounded ? 1 : 0}`);
}

runPipeline().catch(console.error);
