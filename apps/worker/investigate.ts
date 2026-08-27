import 'dotenv/config';
import { supabase } from './src/db.js';
import fs from 'fs';

async function run() {
  const jobId = 'cdcbd859-aaa9-4e06-b2fe-237d0b9c0813';
  const { data: job } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).single();
  const { data: chunks } = await supabase.from('analysis_chunks').select('*').eq('job_id', jobId);
  const chunkIds = chunks ? chunks.map(c => c.id) : [];
  let runs = [];
  if (chunkIds.length > 0) {
    const { data: chunkRuns } = await supabase.from('analysis_chunk_runs').select('id, diagnostic_logs, ai_findings, raw_notes, chunk_id').in('chunk_id', chunkIds);
    runs = chunkRuns || [];
  }
  
  console.log('Job exists:', !!job);
  console.log('Job status:', job?.status);
  console.log('Chunks:', chunks?.length);
  if (chunks?.length > 0) {
    console.log('Chunk status:', chunks[0].status, 'error:', chunks[0].last_error);
  }
  console.log('Runs:', runs.length);
  
  if (runs.length > 0) {
    const r = runs[0];
    let diag = r.diagnostic_logs;
    if (typeof diag === 'string') {
      try { diag = JSON.parse(diag); } catch(e){}
    }
    console.log('Diag logs for run:', diag ? JSON.stringify(diag).substring(0, 500) : 'null');
    console.log('Raw notes:', r.raw_notes ? JSON.stringify(r.raw_notes).substring(0, 200) : 'null');
  }

  // Also check if notes were passed through pipeline
  const { data: aggregatedNotes } = await supabase.from('analysis_review_findings').select('*').eq('job_id', jobId).eq('is_note', true);
  console.log('Aggregated notes count:', aggregatedNotes?.length);
  
  // Also check Git commit from worker
  // usually logs might show it, or we can check the deployed commit using git if it's running locally
  // Wait, "live pipeline" or "production job" - the worker might be running elsewhere?
}
run();
