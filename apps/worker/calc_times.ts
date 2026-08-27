import { supabase } from './src/db.js';

async function run() {
  const jobId = '7136cd89-b87c-43f4-a346-3b2b93a6c8ae';
  const { data: job } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).single();
  const { data: chunks } = await supabase.from('analysis_chunks').select('*').eq('job_id', jobId).order('created_at', { ascending: true });
  const { data: findings } = await supabase.from('analysis_review_findings').select('created_at').eq('created_from_job_id', jobId).order('created_at', { ascending: true });
  const { data: reports } = await supabase.from('reports').select('created_at').eq('job_id', jobId);

  console.log('--- Timeline for Job', jobId, '---');
  console.log('Job Started:', job?.started_at);
  if (chunks && chunks.length > 0) {
    console.log('Chunk 0 Created:', chunks[0].created_at);
    console.log('Chunk 0 Judging Started:', chunks[0].judging_started_at);
    console.log('Chunk 0 Updated:', chunks[0].updated_at); // Not in the schema explicitly, but might exist
  }
  if (findings && findings.length > 0) {
    console.log('First Finding Created:', findings[0].created_at);
    console.log('Last Finding Created:', findings[findings.length - 1].created_at);
  }
  if (reports && reports.length > 0) {
    console.log('Report Created:', reports[0].created_at);
  }
  console.log('Job Completed:', job?.completed_at);
  process.exit(0);
}
run();
