import { supabase } from './src/db.js';
import fs from 'fs';
async function run() {
  const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
  const { data } = await supabase.from('analysis_chunks').select('id').eq('job_id', JOB);
  fs.writeFileSync('chunks.json', JSON.stringify(data || [], null, 2));
}
run();
