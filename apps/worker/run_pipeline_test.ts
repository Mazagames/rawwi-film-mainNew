import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from './src/db.js';
import { processChunkForJob } from './src/pipelineRunner.js';
import fs from 'fs';

async function run() {
  const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
  console.log(`Running real pipeline on JOB ${JOB}`);

  const { data: job } = await supabase.from('analysis_jobs').select('*').eq('id', JOB).single();
  const { data: chunks } = await supabase.from('analysis_chunks').select('*').eq('job_id', JOB).limit(1);
  const chunk = chunks?.[0];

  if (!chunk) throw new Error("No chunk found");
  
  // Force only article 17
  job.execution_plan = {
    planVersion: "1.0",
    activePasses: [{ name: "v5_article_17", articleIds: [17] }],
    skippedPasses: []
  };

  const normalizedText = chunk.text; 
  const abortController = new AbortController();
  await processChunkForJob(job as any, chunk as any, normalizedText, abortController.signal);

  // Now query the DB for the results
  const { data: runs } = await supabase.from('analysis_chunk_runs').select('*').eq('chunk_id', chunk.id).order('created_at', { ascending: false }).limit(1);
  const runData = runs?.[0];
  
  if (!runData) {
    console.log("No run data found.");
    return;
  }

  const rawFindings = runData.ai_findings || [];
  const validatedFindings = runData.validated_ai_findings || [];
  const validatorAudit = runData.validator_audit_json || { summary: {} };
  
  const violations = validatedFindings.filter((f: any) => f.article_id !== 0 && f.article_id != null);
  const notes = validatedFindings.filter((f: any) => f.article_id === 0 || f.article_id == null);

  console.log("\n=== PIPELINE RESULTS ===");
  console.log("Raw Gemini Findings Count:", rawFindings.length);
  if (rawFindings.length > 0) {
    console.log("Sample Raw Finding:", JSON.stringify(rawFindings[0], null, 2));
  }
  
  console.log("Validated Findings Count:", validatedFindings.length);
  if (validatedFindings.length > 0) {
    console.log("Sample Validated Finding:", JSON.stringify(validatedFindings[0], null, 2));
  }
  
  console.log("\nCounts:");
  console.log("Violation Count:", violations.length);
  console.log("Note Count:", notes.length);
  console.log("Validator Result Summary:", JSON.stringify(validatorAudit.summary, null, 2));
  console.log("Persisted Finding Count:", validatedFindings.length);
}

run().catch(console.error);
