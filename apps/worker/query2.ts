import { supabase } from './src/db.js';

async function run() {
  const { data, error } = await supabase
    .from('analysis_judge_diagnostics')
    .select('pass_name, judge_model, finish_reason, openai_usage, raw_judge_response, timestamp, job_id, chunk_id')
    .order('timestamp', { ascending: false })
    .limit(21);
    
  if (error) {
    console.error(error);
    process.exit(1);
  }
  
  const mapped = data.map(d => ({
    pass: d.pass_name,
    model: d.judge_model,
    finish: d.finish_reason,
    prompt: d.openai_usage?.prompt_tokens,
    completion: d.openai_usage?.completion_tokens,
    thoughts: (d.openai_usage as any)?.thoughts_tokens,
    total: d.openai_usage?.total_tokens,
    raw_len: d.raw_judge_response?.length,
    jobId: d.job_id,
    chunkId: d.chunk_id
  }));
  
  console.log(JSON.stringify(mapped, null, 2));
  process.exit(0);
}

run();
