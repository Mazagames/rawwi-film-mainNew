import fs from 'fs';
const data = JSON.parse(fs.readFileSync('job_investigation.json', 'utf-8'));
console.log(JSON.stringify(data.job?.diagnostic_logs, null, 2));
