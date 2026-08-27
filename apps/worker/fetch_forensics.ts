import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";
import * as fs from "fs";

async function main() {
  const currentJobId = "3ff94672-46e7-48a5-83ae-316977bc62cd";
  
  // Fetch current job runs
  const { data: currentRuns } = await supabase.from("analysis_chunk_runs").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`job_${currentJobId}_runs.json`, JSON.stringify(currentRuns, null, 2));

  // Fetch telemetry logs
  const { data: currentLogs } = await supabase.from("pipeline_telemetry_logs").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`job_${currentJobId}_telemetry.json`, JSON.stringify(currentLogs, null, 2));
  
  const { data: currentNotes } = await supabase.from("analysis_notes").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`job_${currentJobId}_notes.json`, JSON.stringify(currentNotes, null, 2));
  
  console.log("Looking for known-good job...");
  const { data: allNotes } = await supabase.from("analysis_notes").select("job_id").eq("category", "security_scenes");
  if (!allNotes) {
    console.log("No security notes found globally!");
    return;
  }
  
  const counts: Record<string, number> = {};
  for (const n of allNotes) {
    counts[n.job_id] = (counts[n.job_id] || 0) + 1;
  }
  
  let bestJobId = "";
  let highest = 0;
  for (const [jid, count] of Object.entries(counts)) {
    if (count > highest && jid !== currentJobId) {
      highest = count;
      bestJobId = jid;
    }
  }
  
  console.log(`Found good job ${bestJobId} with ${highest} notes.`);
  
  if (bestJobId) {
    const { data: bestRuns } = await supabase.from("analysis_chunk_runs").select("*").eq("job_id", bestJobId);
    fs.writeFileSync(`job_${bestJobId}_runs.json`, JSON.stringify(bestRuns, null, 2));
    
    const { data: bestLogs } = await supabase.from("pipeline_telemetry_logs").select("*").eq("job_id", bestJobId);
    fs.writeFileSync(`job_${bestJobId}_telemetry.json`, JSON.stringify(bestLogs, null, 2));

    const { data: bestNotes } = await supabase.from("analysis_notes").select("*").eq("job_id", bestJobId);
    fs.writeFileSync(`job_${bestJobId}_notes.json`, JSON.stringify(bestNotes, null, 2));
  }
}
main().catch(console.error);
