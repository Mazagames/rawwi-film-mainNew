import 'dotenv/config';
import { supabase } from './src/db.js';
import fs from 'fs';

async function run() {
  try {
    const jobId = 'cdcbd859-aaa9-4e06-b2fe-237d0b9c0813';
    
    const { data: runs, error } = await supabase.from('analysis_chunk_runs').select('id, raw_notes, chunk_id, job_id, run_key, diagnostic_logs, raw_ai_findings').eq('job_id', jobId);
    
    const { data: logs } = await supabase.from('analysis_logs').select('message, details, created_at').eq('job_id', jobId);
    
    const result = {
      runsCount: runs?.length,
      runsErr: error,
      runsData: runs ? runs.map(r => ({
        id: r.id,
        chunk_id: r.chunk_id,
        run_key: r.run_key,
        diagnostic_logs: r.diagnostic_logs,
        raw_notes_length: r.raw_notes?.length,
        hasRawNotes: !!r.raw_notes,
        hasRawFindings: !!r.raw_ai_findings
      })) : [],
      logsCount: logs?.length,
      ownershipLogs: logs?.filter(l => l.message && l.message.includes('Deterministic ownership')),
      gitLogs: logs?.filter(l => l.message && (l.message.includes('worker started') || l.message.includes('commit'))),
      noteStartLogs: logs?.filter(l => l.message && l.message.includes('runNotesDetection')),
      noteSummaryLogs: logs?.filter(l => l.message && l.message.includes('Note reviewer validation summary'))
    };

    fs.writeFileSync('job_cdc_final.json', JSON.stringify(result, null, 2));
    console.log('Saved job_cdc_final.json');
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
