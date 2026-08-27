import { supabase } from './src/db.js';

async function run() {
  const { data, error } = await supabase.from('analysis_jobs').select('*').eq('id', '7136cd89-b87c-43f4-a346-3b2b93a6c8ae').single();
  if (error) { console.error('Job error', error); process.exit(1); }
  
  console.log('--- Job Diagnostics ---');
  console.log(JSON.stringify(data?.diagnostic_logs || data?.logs || data?.metrics || {}, null, 2));
  
  const { data: chunks, error: chunksErr } = await supabase.from('analysis_chunks').select('*').eq('job_id', '7136cd89-b87c-43f4-a346-3b2b93a6c8ae');
  if (chunksErr) { console.error('Chunks error', chunksErr); process.exit(1); }
  
  if (chunks && chunks.length > 0) {
    console.log('\n--- Chunk 0 Diagnostics ---');
    console.log(JSON.stringify(chunks[0].diagnostic_logs || {}, null, 2));
  } else {
    console.log('\nNo chunks found.');
  }
  process.exit(0);
}
run();
