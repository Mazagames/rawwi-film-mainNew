import { supabase } from './src/db.js';
import fs from 'fs';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data: runs, error } = await supabase
    .from('analysis_chunk_runs')
    .select('*')
    .eq('job_id', JOB);
    
  if (error) {
    console.error(error);
    return;
  }
  
  if (runs && runs.length > 0) {
    console.log(Object.keys(runs[0]).join(', '));
    fs.writeFileSync('temp_run_dump.json', JSON.stringify(runs[0], null, 2));
    console.log('Saved temp_run_dump.json');
  } else {
    console.log('No runs found');
  }
}
run().catch(console.error);
