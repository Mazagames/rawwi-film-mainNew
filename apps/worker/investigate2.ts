import 'dotenv/config';
import { supabase } from './src/db.js';
import fs from 'fs';

async function run() {
  try {
    const jobId = 'cdcbd859-aaa9-4e06-b2fe-237d0b9c0813';
    
    // 1. Check Git Commit
    const { data: logs } = await supabase.from('analysis_logs').select('*').eq('job_id', jobId);
    const gitLog = logs?.find(l => l.message && l.message.includes('commit'));
    const startupLog = logs?.find(l => l.message && l.message.includes('worker started'));
    console.log('--- GIT COMMIT ---');
    console.log(gitLog || startupLog || 'No git commit log found');

    // 2. Check Deterministic Ownership Log
    const ownershipLog = logs?.find(l => l.message && l.message.includes('Deterministic ownership'));
    console.log('--- DETERMINISTIC OWNERSHIP LOG ---');
    console.log(ownershipLog ? ownershipLog : 'No ownership log found');

    // 3. Trace Note Detection
    console.log('--- NOTE DETECTION PIPELINE TRACE ---');
    const noteStartLog = logs?.find(l => l.message && l.message.includes('runNotesDetection'));
    const noteSummaryLog = logs?.find(l => l.message && l.message.includes('Note reviewer validation summary'));
    console.log('Note Start:', noteStartLog || 'Not found');
    console.log('Note Summary:', noteSummaryLog || 'Not found');
    
    // Check if runNotesDetection was skipped
    const chunkLogs = logs?.filter(l => l.message && l.message.toLowerCase().includes('note'));
    fs.writeFileSync('job_cdc_notes_logs.json', JSON.stringify(chunkLogs, null, 2));
    console.log('Saved note-related logs to job_cdc_notes_logs.json');

    // 4. Check analysis_chunk_runs
    const { data: chunks } = await supabase.from('analysis_chunks').select('*').eq('job_id', jobId);
    if (chunks && chunks.length > 0) {
      const { data: runs } = await supabase.from('analysis_chunk_runs').select('id, raw_notes, ai_findings, diagnostic_logs').eq('chunk_id', chunks[0].id);
      if (runs && runs.length > 0) {
        fs.writeFileSync('job_cdc_runs.json', JSON.stringify(runs[0], null, 2));
        console.log('Saved runs to job_cdc_runs.json');
      } else {
        console.log('No runs found in DB for chunk', chunks[0].id);
      }
    } else {
      console.log('No chunks found');
    }
  } catch (e) {
    console.error(e);
  }
}
run();
