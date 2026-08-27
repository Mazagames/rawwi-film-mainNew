import * as fs from 'fs';

const cJob = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_job.json', 'utf8'));
const cChunks = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_chunks.json', 'utf8'));
const cRuns = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_runs.json', 'utf8'));
const cNotes = JSON.parse(fs.readFileSync('job_3ff94672-46e7-48a5-83ae-316977bc62cd_notes.json', 'utf8'));

const gJob = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_job.json', 'utf8'));
const gChunks = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_chunks.json', 'utf8'));
const gRuns = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_runs.json', 'utf8'));
const gNotes = JSON.parse(fs.readFileSync('job_a8827906-a640-4a5a-a7ce-95876b16ea1f_notes.json', 'utf8'));

console.log("=== CURRENT JOB (3ff9) ===");
console.log("Job status:", cJob.status);
console.log("Chunk diagnostic logs present:", !!cChunks[0]?.diagnostic_logs);
if (cChunks[0]?.diagnostic_logs) {
  const logs = cChunks[0].diagnostic_logs.filter(l => l.details?.reviewer === 'notes_security_scenes' || l.details?.passName === 'notes_security_scenes');
  console.log("Security Telemetry in Chunk:", JSON.stringify(logs, null, 2));
}
console.log("Notes raw output:", cRuns[0]?.notes_raw_output?.slice(0, 100));

console.log("\n=== GOOD JOB (a882) ===");
console.log("Job status:", gJob.status);
console.log("Chunk diagnostic logs present:", !!gChunks[0]?.diagnostic_logs);
if (gChunks[0]?.diagnostic_logs) {
  const logs = gChunks[0].diagnostic_logs.filter(l => l.details?.reviewer === 'notes_security_scenes' || l.details?.passName === 'notes_security_scenes');
  console.log("Security Telemetry in Chunk:", JSON.stringify(logs, null, 2));
}

// Write the findings to an artifact file
let markdown = `# Security Notes Investigation

## Forensic Comparison

| Metric | Current Run (3ff9...) | Known-Good Run (a882...) |
|--------|-----------------------|--------------------------|
| Total Security Notes | ${cNotes.filter(n => n.category === 'security_scenes').length} | ${gNotes.filter(n => n.category === 'security_scenes').length} |
| Input Event Count | ${cRuns[0]?.ai_findings?.length ?? 'Unknown'} | ${gRuns[0]?.ai_findings?.length ?? 'Unknown'} |
| Prompt Hash | ${cChunks[0]?.diagnostic_logs?.find(l => l.action === 'Note reviewer completed' && l.details?.reviewer === 'notes_security_scenes')?.details?.promptHash ?? 'Unknown'} | ${gChunks[0]?.diagnostic_logs?.find(l => l.action === 'Note reviewer completed' && l.details?.reviewer === 'notes_security_scenes')?.details?.promptHash ?? 'Unknown'} |
| Finish Reason | ${cChunks[0]?.diagnostic_logs?.find(l => l.action === 'Note reviewer completed' && l.details?.reviewer === 'notes_security_scenes')?.details?.finishReason ?? 'Unknown'} | ${gChunks[0]?.diagnostic_logs?.find(l => l.action === 'Note reviewer completed' && l.details?.reviewer === 'notes_security_scenes')?.details?.finishReason ?? 'Unknown'} |
`;

fs.writeFileSync("C:/Users/wahid/.gemini/antigravity-ide/brain/14e69c26-66f0-46be-8541-6f399376b446/investigation_security_notes.md", markdown);
console.log("Wrote artifact.");
