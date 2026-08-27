import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";
import * as fs from "fs";

async function main() {
  const currentJobId = "3ff94672-46e7-48a5-83ae-316977bc62cd";
  
  // Fetch current job
  const { data: currentJob } = await supabase.from("analysis_jobs").select("*").eq("id", currentJobId).single();
  fs.writeFileSync(`job_${currentJobId}_job.json`, JSON.stringify(currentJob, null, 2));

  // Fetch current chunks
  const { data: currentChunks } = await supabase.from("analysis_chunks").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`job_${currentJobId}_chunks.json`, JSON.stringify(currentChunks, null, 2));

  // Same for good job: a8827906-a640-4a5a-a7ce-95876b16ea1f
  const goodJobId = "a8827906-a640-4a5a-a7ce-95876b16ea1f";
  const { data: goodJob } = await supabase.from("analysis_jobs").select("*").eq("id", goodJobId).single();
  fs.writeFileSync(`job_${goodJobId}_job.json`, JSON.stringify(goodJob, null, 2));

  const { data: goodChunks } = await supabase.from("analysis_chunks").select("*").eq("job_id", goodJobId);
  fs.writeFileSync(`job_${goodJobId}_chunks.json`, JSON.stringify(goodChunks, null, 2));
}
main().catch(console.error);
