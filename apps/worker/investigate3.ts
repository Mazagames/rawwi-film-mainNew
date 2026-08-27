import 'dotenv/config';
import { supabase } from './src/db.js';
import fs from 'fs';

async function run() {
  const jobId = 'cdcbd859-aaa9-4e06-b2fe-237d0b9c0813';
  const { data: job, error: err1 } = await supabase.from('analysis_jobs').select('status, id, diagnostic_logs').eq('id', jobId).single();
  const { data: logs, error: err2 } = await supabase.from('analysis_logs').select('id, message, details').eq('job_id', jobId);
  const { data: chunks } = await supabase.from('analysis_chunks').select('id').eq('job_id', jobId);
  let runs = [];
  if (chunks?.length) {
    const { data: chunkRuns, error: err3 } = await supabase.from('analysis_chunk_runs').select('id, raw_notes, diagnostic_logs, ai_findings').eq('chunk_id', chunks[0].id);
    runs = chunkRuns || [];
  }

  const result = {
    job: job,
    jobErr: err1,
    logsCount: logs?.length,
    logsErr: err2,
    chunksCount: chunks?.length,
    runsCount: runs.length,
    run0Diags: runs.length > 0 ? runs[0].diagnostic_logs : null,
    run0RawNotes: runs.length > 0 ? runs[0].raw_notes : null,
    // look for specific logs
    gitLog: logs?.find(l => l.message && (l.message.includes('commit') || l.message.includes('worker started'))),
    ownershipLog: logs?.find(l => l.message && l.message.includes('Deterministic ownership')),
    noteStartLog: logs?.find(l => l.message && l.message.includes('runNotesDetection')),
    noteSummaryLog: logs?.find(l => l.message && l.message.includes('Note reviewer validation summary'))
  };

  fs.writeFileSync('job_cdc_full_check.json', JSON.stringify(result, null, 2));
  console.log('Done');
  process.exit(0);
}
run();
