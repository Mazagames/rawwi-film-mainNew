const fs = require('fs');
const data = JSON.parse(fs.readFileSync('job_7136.json', 'utf-8'));
const job = data.job;
const chunks = data.chunks || [];
const start = new Date(job.started_at).getTime();
const complete = new Date(job.completed_at).getTime();
console.log('Total worker duration:', (complete - start) / 1000, 'seconds');

if (chunks.length > 0) {
  let chunk0 = chunks[0];
  let logs = chunk0.diagnostic_logs;
  if (logs) {
    if (typeof logs === 'string') logs = JSON.parse(logs);
    console.log('\n--- Chunk 0 logs ---');
    if (logs.eventUnderstanding) console.log('Event Understanding:', logs.eventUnderstanding.durationMs, 'ms');
    if (logs.eventUnderstandingVerifier) console.log('Event Understanding Verifier:', logs.eventUnderstandingVerifier.durationMs, 'ms');
    if (logs.multiPassRun) console.log('MultiPass Run (Judges total):', logs.multiPassRun.totalDuration, 'ms');
    if (logs.multiPassRun?.passResults) {
      let judgeSum = 0;
      for (const p of logs.multiPassRun.passResults) judgeSum += p.duration;
      console.log('  Sum of individual judge passes:', judgeSum, 'ms');
    }
  }
}

if (job.diagnostic_logs) {
  let logs = job.diagnostic_logs;
  if (typeof logs === 'string') logs = JSON.parse(logs);
  console.log('\n--- Job logs ---');
  if (logs.validator) console.log('Validator:', logs.validator.durationMs, 'ms');
  if (logs.persistence) console.log('Persistence:', logs.persistence.durationMs, 'ms');
  if (logs.aggregation) console.log('Aggregation:', logs.aggregation.durationMs, 'ms');
  if (logs.reportGeneration) console.log('Report Generation:', logs.reportGeneration.durationMs, 'ms');
}
process.exit(0);
