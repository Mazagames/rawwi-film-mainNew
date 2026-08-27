import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from './src/db.js';
import fs from 'fs';

async function trace() {
  const { data: runs } = await supabase
    .from('analysis_chunk_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!runs || runs.length === 0) {
    console.log("No runs found");
    return;
  }
  const run = runs[0];
  fs.writeFileSync('run_dump.json', JSON.stringify({
    raw_findings: run.ai_findings || [],
    validated_findings: run.validated_ai_findings || [],
    validator_audit: run.validator_audit_json || {},
    ai_events: run.ai_events || []
  }, null, 2));

  const { data: traces } = await supabase
    .from('analysis_reviewer_traces')
    .select('*')
    .eq('chunk_id', run.chunk_id);

  fs.writeFileSync('traces_dump.json', JSON.stringify(traces, null, 2));
  console.log("Dumped run data and traces.");
}

trace().catch(console.error);
