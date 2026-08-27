import { supabase } from './src/db.js';
import fs from 'fs';

const JOB_ID = 'f9e61999-6912-414e-a3fe-c0106a7bd859';

async function run() {
  console.log('=== DISCOVERY: all tables that have rows for this job ===');
  // Try every plausible table name
  const candidates = [
    'analysis_jobs', 'analysis_chunks', 'analysis_findings', 'analysis_review_findings',
    'analysis_pass_results', 'analysis_run_results', 'analysis_job_runs', 'analysis_runs',
    'analysis_event_understanding', 'analysis_event_understandings', 'analysis_events',
    'analysis_router_decisions', 'analysis_routing', 'pass_plans', 'analysis_pass_plans',
    'analysis_judge_diagnostics', 'judge_diagnostics', 'analysis_pass_diagnostics',
    'analysis_auditor_results', 'auditor_results', 'analysis_validator_results',
    'analysis_lineage_events', 'finding_lineage_events', 'lineage_events',
    'analysis_chunk_passes', 'chunk_passes', 'analysis_chunk_progress',
  ];
  const found: string[] = [];
  for (const t of candidates) {
    const { data, error } = await (supabase as any).from(t).select('id').eq('job_id', JOB_ID).limit(1);
    if (!error && data && data.length > 0) {
      const { count } = await (supabase as any).from(t).select('*', { count: 'exact', head: true }).eq('job_id', JOB_ID);
      console.log(`  FOUND: "${t}" — ${count} rows`);
      found.push(t);
    }
  }

  // Also dump entire job
  const { data: job } = await supabase.from('analysis_jobs').select('*').eq('id', JOB_ID).maybeSingle();
  console.log('\n=== FULL JOB RECORD KEYS ===');
  for (const [k, v] of Object.entries(job ?? {})) {
    const str = typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300);
    console.log(`  ${k}: ${str}`);
  }
  fs.writeFileSync('job2_full_record.json', JSON.stringify(job, null, 2));

  // Dump all found tables
  for (const t of found) {
    if (t === 'analysis_jobs') continue;
    const { data } = await (supabase as any).from(t).select('*').eq('job_id', JOB_ID);
    fs.writeFileSync(`job2_${t}.json`, JSON.stringify(data, null, 2));
    console.log(`\n=== ${t} (${data?.length} rows) ===`);
    for (const row of (data ?? []).slice(0, 3)) {
      const keys = Object.keys(row);
      for (const k of keys.slice(0, 15)) {
        const v = row[k];
        const str = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v ?? '').slice(0, 200);
        console.log(`    ${k}: ${str}`);
      }
      console.log('  ---');
    }
  }
}

run().catch(console.error);
