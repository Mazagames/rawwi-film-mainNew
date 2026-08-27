import { supabase } from './src/db.js';
import fs from 'fs';
const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
async function run() {
  try {
    const { data: runs, error } = await supabase.from('analysis_chunk_runs').select('ai_findings').eq('job_id', JOB);
    if (error) throw error;
    fs.writeFileSync('raw.json', JSON.stringify(runs, null, 2));
    console.log('Success, wrote raw.json with length:', runs?.length);
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
