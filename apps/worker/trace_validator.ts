import { supabase } from './src/db.js';
import fs from 'fs';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data, error } = await supabase
    .from('analysis_chunk_runs')
    .select('run_key, validator_audit_json, router_candidates, ai_findings, raw_ai_findings')
    .eq('job_id', JOB)
    .single();
    
  if (error) {
    console.error(error);
    return;
  }
  
  if (data?.validator_audit_json) {
    fs.writeFileSync('validator_audit_dump.json', JSON.stringify(data.validator_audit_json, null, 2));
    console.log('Saved validator_audit_dump.json');
  } else {
    console.log('No validator_audit_json found');
  }

  if (data?.ai_findings) {
    fs.writeFileSync('ai_findings_dump.json', JSON.stringify(data.ai_findings, null, 2));
    console.log('Saved ai_findings_dump.json');
  }
}
run().catch(console.error);
