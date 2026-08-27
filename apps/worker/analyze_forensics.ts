import * as fs from 'fs';

const currentRuns = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_runs.json', 'utf8'));
const currentTelemetry = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_telemetry.json', 'utf8'));
const goodTelemetry = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_telemetry.json', 'utf8'));
const goodRuns = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_runs.json', 'utf8'));

// Find security notes execution in current
const currentSecLogs = currentTelemetry.filter((l: any) => 
  (l.action === 'Note reviewer completed' || l.action === 'Note reviewer validation summary' || l.action === 'Judge Diagnostics') &&
  (l.details?.reviewer === 'notes_security_scenes' || l.details?.passName === 'notes_security_scenes')
);
console.log("Current Security Telemetry Logs:");
console.log(JSON.stringify(currentSecLogs, null, 2));

// Find security notes execution in good
const goodSecLogs = goodTelemetry.filter((l: any) => 
  (l.action === 'Note reviewer completed' || l.action === 'Note reviewer validation summary' || l.action === 'Judge Diagnostics') &&
  (l.details?.reviewer === 'notes_security_scenes' || l.details?.passName === 'notes_security_scenes')
);
console.log("Good Security Telemetry Logs:");
console.log(JSON.stringify(goodSecLogs.slice(0, 3), null, 2)); // Just the first chunk for now

// Check raw outputs in runs
console.log("\nCurrent Runs properties:", Object.keys(currentRuns[0]));
console.log("Current Chunk length:", currentRuns[0]?.event_count);
console.log("Good Chunk length:", goodRuns[0]?.event_count);
