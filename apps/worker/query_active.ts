import { supabase } from './src/db.js';
const JOB_ID = 'f9e61999-6912-414e-a3fe-c0106a7bd859';
async function run() {
  const { data, error } = await supabase.from('analysis_chunks').select('*').eq('job_id', JOB_ID);
  if (error) console.error(error);
  else console.log(JSON.stringify(data?.[0], null, 2));
}
run();
