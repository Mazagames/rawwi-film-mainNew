import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";
import * as fs from "fs";

async function main() {
  const currentJobId = "3ff94672-46e7-48a5-83ae-316977bc62cd";
  
  console.log(`Fetching current job ${currentJobId}...`);
  const { data: currentRuns } = await supabase.from("analysis_chunk_runs").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`current_job_runs.json`, JSON.stringify(currentRuns, null, 2));

  const { data: currentNotes } = await supabase.from("analysis_review_notes").select("*").eq("job_id", currentJobId);
  fs.writeFileSync(`current_job_notes.json`, JSON.stringify(currentNotes, null, 2));

  // Find a known good job
  console.log("Looking for a known-good job with high security notes...");
  const { data: allSecurityNotes } = await supabase.from("analysis_review_notes")
    .select("job_id")
    .eq("category", "security_scenes");
    
  if (!allSecurityNotes) {
    console.log("No security notes found globally!");
    return;
  }
  
  const jobCounts: Record<string, number> = {};
  for (const row of allSecurityNotes) {
    jobCounts[row.job_id] = (jobCounts[row.job_id] || 0) + 1;
  }
  
  let knownGoodJobId = "";
  let highestCount = 0;
  for (const [jid, count] of Object.entries(jobCounts)) {
    if (count > highestCount && jid !== currentJobId) {
      highestCount = count;
      knownGoodJobId = jid;
    }
  }
  
  console.log(`Found known-good job: ${knownGoodJobId} with ${highestCount} security notes.`);
  if (knownGoodJobId) {
    const { data: goodRuns } = await supabase.from("analysis_chunk_runs").select("*").eq("job_id", knownGoodJobId);
    fs.writeFileSync(`good_job_runs.json`, JSON.stringify(goodRuns, null, 2));

    const { data: goodNotes } = await supabase.from("analysis_review_notes").select("*").eq("job_id", knownGoodJobId);
    fs.writeFileSync(`good_job_notes.json`, JSON.stringify(goodNotes, null, 2));
  }
  
  console.log("Done.");
}

main().catch(console.error);
