import { config as loadEnv } from 'dotenv';
loadEnv();
import * as fs from "fs";

async function main() {
  const { supabase } = await import("./src/db.js");
  const jobIds = ["8a9ad4e3-05c5-42f9-83ad-165ed6c70812"];
  for (const jobId of jobIds) {
    const { data: job } = await supabase.from("analysis_jobs").select("*").eq("id", jobId).single();
    if (job) {
      fs.writeFileSync(`job_${jobId}.json`, JSON.stringify(job, null, 2));
      console.log(`Fetched job ${jobId}`);
    }

    const { data: runs } = await supabase.from("analysis_chunk_runs").select("*").eq("job_id", jobId);
    if (runs) {
      fs.writeFileSync(`job_${jobId}_runs.json`, JSON.stringify(runs, null, 2));
      console.log(`Fetched runs for ${jobId}`);
    }

    const { data: notes } = await supabase.from("analysis_notes").select("*").eq("job_id", jobId);
    if (notes) {
      fs.writeFileSync(`job_${jobId}_notes.json`, JSON.stringify(notes, null, 2));
      console.log(`Fetched notes for ${jobId}`);
    }
    
    const { data: logs } = await supabase.from("pipeline_telemetry_logs").select("*").eq("job_id", jobId);
    if (logs && logs.length > 0) {
      fs.writeFileSync(`job_${jobId}_telemetry.json`, JSON.stringify(logs, null, 2));
      console.log(`Fetched telemetry for ${jobId} (${logs.length} rows)`);
    }
  }
}

main().catch(console.error);
