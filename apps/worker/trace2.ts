import { supabase } from './src/db.js';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data: chunks, error: ce } = await supabase
    .from('analysis_chunks')
    .select('id, chunk_index, status, current_findings_count, processing_phase, last_error')
    .eq('job_id', JOB)
    .order('chunk_index');
  if (ce) console.error('chunk err:', ce);
  console.log('=== CHUNKS ===');
  console.log(JSON.stringify(chunks, null, 2));

  const { data: findings, error: fe } = await supabase
    .from('analysis_findings')
    .select('id, finding_uuid, article_id, title_ar, evidence_snippet, severity, confidence, source, lineage_id, created_at')
    .eq('job_id', JOB)
    .order('created_at');
  if (fe) console.error('findings err:', fe);
  console.log('\n=== FINDINGS count:', findings?.length ?? 0, '===');
  console.log(JSON.stringify(findings, null, 2));

  // Judge diagnostics for this job
  const { data: diagAll, error: de } = await supabase
    .from('analysis_judge_diagnostics')
    .select('*')
    .eq('job_id', JOB)
    .limit(5);
  if (de) console.error('diag err:', de);
  console.log('\n=== JUDGE DIAG (first 5) ===');
  console.log(JSON.stringify(diagAll, null, 2));

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
