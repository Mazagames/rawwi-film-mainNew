import { supabase } from './src/db.js';
import fs from 'fs';

async function run() {
  const jobId = 'e8901ebf-1c83-4a4a-a7d6-d544322a7a3d';
  console.log('Fetching job data...');
  
  const { data: job, error: jobErr } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).single();
  if (jobErr) console.error('Job err:', jobErr);

  const { data: chunks, error: chunkErr } = await supabase.from('analysis_chunks').select('*').eq('job_id', jobId).order('chunk_index');
  if (chunkErr) console.error('Chunk err:', chunkErr);

  const { data: runs, error: runErr } = await supabase.from('analysis_chunk_runs').select('*').eq('job_id', jobId);
  if (runErr) console.error('Run err:', runErr);
  
  const { data: findings, error: findErr } = await supabase.from('analysis_review_findings').select('*').eq('job_id', jobId);
  if (findErr) console.error('Find err:', findErr);

  fs.writeFileSync('job_investigation.json', JSON.stringify({
    job,
    chunks: chunks?.map((c: any) => ({ id: c.id, index: c.chunk_index, status: c.status })),
    runs: runs?.map((r: any) => ({
      id: r.id,
      job_id: r.job_id,
      run_key: r.run_key,
      ai_findings: r.ai_findings,
      validated_ai_findings: r.validated_ai_findings,
      truth_layer_meta: r.truth_layer_meta
    })),
    findings
  }, null, 2));
  console.log('Saved to job_investigation.json');
}

run().catch(console.error);
