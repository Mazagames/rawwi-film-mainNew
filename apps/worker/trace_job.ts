import { supabase } from './src/db.js';

const JOB_ID = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  // 1. Job
  const { data: job, error: jobErr } = await supabase
    .from('analysis_jobs')
    .select('id, status, script_id, version_id, created_at')
    .eq('id', JOB_ID)
    .single();
  if (jobErr) console.error('job err:', jobErr);
  console.log('=== JOB ===');
  console.log(JSON.stringify(job, null, 2));

  // 2. Chunks
  const { data: chunks, error: chunkErr } = await supabase
    .from('analysis_chunks')
    .select('id, status, finding_count, chunk_index, validator_status, auditor_status')
    .eq('job_id', JOB_ID)
    .order('chunk_index');
  if (chunkErr) console.error('chunk err:', chunkErr);
  console.log('\n=== CHUNKS ===');
  console.log(JSON.stringify(chunks, null, 2));

  // 3. Findings for this job
  const { data: findings, error: findErr } = await supabase
    .from('analysis_findings')
    .select('id, article_id, event_id, finding_uuid, title_ar, evidence_snippet, severity, confidence, chunk_id, created_at')
    .eq('job_id', JOB_ID)
    .order('created_at');
  if (findErr) console.error('findings err:', findErr);
  console.log('\n=== FINDINGS (' + (findings?.length ?? 0) + ') ===');
  console.log(JSON.stringify(findings, null, 2));

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
