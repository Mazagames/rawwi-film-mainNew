import { supabase } from './src/db.js';
import fs from 'fs';
async function run() {
  const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
  const { data: findings } = await supabase.from('analysis_findings').select('*').eq('job_id', JOB);
  fs.writeFileSync('analysis_findings.json', JSON.stringify(findings ?? [], null, 2));
}
run().catch(console.error);
