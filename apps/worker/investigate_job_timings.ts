import { supabase } from './src/db.js';

async function run() {
  const { data: logs, error } = await supabase.from('pipeline_telemetry_logs').select('*').eq('job_id', '8a9ad4e3-05c5-42f9-83ad-165ed6c70812').order('created_at', { ascending: true });
  if (error) {
    console.log("Error", error);
    process.exit(1);
  }
  
  if (logs && logs.length > 0) {
    for (const r of logs) {
      console.log(r.created_at, r.event_type, r.stage_label, r.action_label, JSON.stringify(r.payload));
    }
  } else {
    console.log("No telemetry logs found.");
  }
  process.exit(0);
}

run();
