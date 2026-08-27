import { supabase } from './src/db.js';
import { callJudgeRaw, parseJudgeWithRepair } from './src/openai.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runDifficultPass() {
  const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
  
  // Get the chunk
  const { data: chunks } = await supabase.from('analysis_chunks').select('id, chunk_text_ar').not('chunk_text_ar', 'is', null).limit(1);
  let chunkText = chunks?.[0]?.chunk_text_ar || "";
  
  // If no chunks in db, use a mock difficult chunk by repeating a complex sentence 1000 times
  if (!chunkText || chunkText.length < 100) {
    chunkText = "المشهد الداخلي، نهاراً: يقوم الرجل بتصوير المرأة خلسة وهي في غرفة تبديل الملابس بهدف ابتزازها لاحقاً ونشر صورها على الإنترنت إذا لم تدفع له مبلغاً مالياً كبيراً.\n".repeat(500);
  }
  const chunk = { chunk_text_ar: chunkText };
  if (!chunk) throw new Error("Chunk not found");
  
  console.log(`Running Article 17 pass on real chunk (length: ${chunk.chunk_text_ar.length})...`);
  
  const articlePath = path.join(__dirname, '../../reviewers/v5/article_17_dignity_reputation_privacy.md');
  const promptText = fs.readFileSync(articlePath, 'utf8');
  
  const article = {
    id: 17,
    title_ar: "الكرامة والسمعة والخصوصية",
    text_ar: "يمنع التشهير",
    atoms: []
  };

  const jobConfig = { judge_model: 'gemini-2.5-pro', temperature: 0, seed: 42 };

  const start = Date.now();
  
  // Call raw judge
  const resp = await callJudgeRaw(chunk.chunk_text_ar, [article as any], 0, chunk.chunk_text_ar.length, jobConfig, promptText, null, {});
  const duration = Date.now() - start;
  
  // Parse with repair
  const { findings, diagnostics } = await parseJudgeWithRepair(resp.raw_judge_response, 'gemini-2.5-pro', {});
  
  console.log("\n=== CONTROLLED TEST RESULT ===");
  console.log(`Duration: ${duration} ms`);
  console.log(`Prompt Tokens: ${resp.usage?.prompt_tokens}`);
  console.log(`Thoughts Tokens: ${(resp.usage as any)?.thoughts_tokens}`);
  console.log(`Output Tokens: ${resp.usage?.completion_tokens}`);
  console.log(`Total Tokens: ${resp.usage?.total_tokens}`);
  console.log(`Finish Reason: ${resp.finish_reason}`);
  console.log(`Repair Attempts: ${diagnostics.repair_invoked ? 1 : 0}`);
  const finding = findings[0];
  if (finding) {
    console.log(`\n=== FINDING DETAILS ===`);
    console.log(`Article ID: ${finding.article_id}`);
    console.log(`Atom / Canonical Atom: ${finding.atom_id} / ${finding.canonical_atom}`);
    console.log(`Title: ${finding.title_ar}`);
    console.log(`Evidence Text: ${finding.evidence_snippet}`);
    console.log(`Offsets: Start ${finding.location?.start_offset}, End ${finding.location?.end_offset}`);
    console.log(`Confidence: ${finding.confidence}`);
    
    // Check verbatim presence
    const chunkText = chunk.chunk_text_ar;
    const verbatim = finding.evidence_snippet ? chunkText.includes(finding.evidence_snippet.trim()) : false;
    console.log(`Exists Verbatim in Screenplay: ${verbatim}`);
    
    console.log(`Is Violation (Not Note): ${finding.article_id !== 0 && finding.article_id != null}`);
    console.log("\n=== VALIDATOR CONCLUSION ===");
    console.log(`Survives Validator: ${verbatim ? 'TRUE (verbatim grounding succeeded)' : 'FALSE (no exact match)'}`);
  } else {
    console.log("\n=== NO FINDINGS PRODUCED ===");
  }
}

runDifficultPass().catch(console.error);
