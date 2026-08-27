import { supabase } from './src/db.js';
import fs from 'fs';

const jobId = '7136cd89-b87c-43f4-a346-3b2b93a6c8ae';

async function run() {
  const { data: job, error } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).single();
  if (error) { console.error('Job Error:', error); return; }

  const { data: chunks, error: chunksErr } = await supabase.from('analysis_chunks').select('*').eq('job_id', jobId).order('created_at', { ascending: true });
  if (chunksErr) { console.error('Chunks Error:', chunksErr); return; }

  const out = { job, chunks };
  fs.writeFileSync('job_7136.json', JSON.stringify(out, null, 2));
  console.log('Saved job_7136.json');
  console.log('Worker Duration:', job.completed_at ? (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000 : 'incomplete');
  console.log('Diagnostic Logs:', JSON.stringify(job.diagnostic_logs, null, 2));
}
run();
