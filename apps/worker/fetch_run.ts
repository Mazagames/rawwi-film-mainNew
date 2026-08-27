import 'dotenv/config';
import { supabase } from './src/db.js';
import * as fs from 'fs';

const JOB = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';

async function trace() {
  const { data: runs } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('job_id', JOB);

  if (!runs || runs.length === 0) {
    console.log("No runs found");
    return;
  }

  const run = runs[0];
  console.log("Found run:", run.id);

  if (run.trace_dump) {
    fs.writeFileSync('job_7e_trace_dump.json', JSON.stringify(run.trace_dump, null, 2));
    console.log("Wrote job_7e_trace_dump.json");
  } else {
    console.log("No trace_dump in run");
  }
}

trace().catch(console.error);
