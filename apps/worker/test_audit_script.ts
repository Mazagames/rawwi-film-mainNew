import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from './src/db.js';
import { processChunkForJob } from './src/pipelineRunner.js';
import fs from 'fs';

async function run() {
  const text = fs.readFileSync('job2_fulltext.txt', 'utf-8');

  const { data: jobs } = await supabase.from('analysis_jobs').select('*').neq('status', 'cancelled').limit(1);
  const existingJob = jobs?.[0];
  if (!existingJob) throw new Error("No existing jobs found in DB to mock");

  await supabase.from('analysis_jobs').update({ status: 'running', pause_requested: false, partial_finalize_requested: false }).eq('id', existingJob.id);

  const { data: chunks } = await supabase.from('analysis_chunks').select('*').eq('job_id', existingJob.id).limit(1);
  const existingChunk = chunks?.[0];
  if (!existingChunk) throw new Error("No existing chunks found in DB to mock");

  await supabase.from('analysis_chunks').update({ status: 'pending' }).eq('id', existingChunk.id);

  // Use all 24 V5 passes for the exact pipeline counts
  const { DETECTION_PASSES } = await import('./src/multiPassJudge.js');
  existingJob.execution_plan = {
    planVersion: "1.0",
    activePasses: DETECTION_PASSES.filter(p => p.name.startsWith('v5_')).map(p => ({
       name: p.name,
       articleIds: p.articleIds
    })),
    skippedPasses: []
  };

  existingChunk.text = text;
  existingChunk.start_offset = 0;
  existingChunk.end_offset = text.length;

  console.log(`Running pipeline on mocked Job/Chunk`);
  const abortController = new AbortController();
  
  // Actually, processChunkForJob writes back to the DB based on chunk.id, 
  // so this will overwrite an existing chunk_run. That's fine for our test.
  await processChunkForJob(existingJob as any, existingChunk as any, text, abortController.signal);

  // Fetch results
  const { data: runs } = await supabase.from('analysis_chunk_runs').select('*').eq('chunk_id', existingChunk.id).order('created_at', { ascending: false }).limit(1);
  const runData = runs?.[0];

  if (!runData) {
    console.log("No run data found.");
    return;
  }

  fs.writeFileSync('audit_results.json', JSON.stringify({
    rawFindings: runData.ai_findings || [],
    validatedFindings: runData.validated_ai_findings || [],
    validatorAudit: runData.validator_audit_json || { summary: {}, rejections: [] }
  }, null, 2));

  console.log("Pipeline finished. Results saved to audit_results.json.");
}

run().catch(console.error);
