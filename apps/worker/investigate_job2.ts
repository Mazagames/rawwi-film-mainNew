import { supabase } from './src/db.js';
import fs from 'fs';

const JOB_ID = 'f9e61999-6912-414e-a3fe-c0106a7bd859';

async function run() {
  // Fetch the full job with normalized_text
  const { data: job } = await supabase
    .from('analysis_jobs')
    .select('*')
    .eq('id', JOB_ID)
    .maybeSingle();
  
  const fullText: string = job?.normalized_text ?? '';
  console.log(`=== SOURCE TEXT (canonical_length=${job?.canonical_length}) ===`);
  console.log(`Config: analysis_engine=${job?.config_snapshot?.analysis_engine}, pipeline_version=${job?.config_snapshot?.pipeline_version}`);
  console.log(`Full text length: ${fullText.length}`);
  
  // Anchor check
  const anchors = ['المشهد 17', 'المشهد 21', 'المشهد 22', 'المشهد 20', 'عاشوراء', 'وزارة الداخلية', 'استوديو تصوير'];
  console.log('\n--- ANCHOR CHECK ---');
  for (const a of anchors) {
    const idx = fullText.indexOf(a);
    console.log(`"${a}": ${idx >= 0 ? `FOUND at offset ${idx}` : 'NOT FOUND'}`);
  }
  fs.writeFileSync('job2_fulltext.txt', fullText, 'utf-8');

  // Chunks
  console.log('\n=== CHUNKS ===');
  const { data: chunks } = await supabase
    .from('analysis_chunks')
    .select('*')
    .eq('job_id', JOB_ID)
    .order('chunk_index');
  for (const c of chunks ?? []) {
    console.log(`chunk[${c.chunk_index}]: offsets ${c.start_offset}-${c.end_offset}, len=${c.chunk_text?.length}`);
  }

  // Findings
  console.log('\n=== RAW FINDINGS (analysis_findings) ===');
  const { data: findings } = await supabase
    .from('analysis_findings')
    .select('*')
    .eq('job_id', JOB_ID)
    .order('article_id');
  console.log(`Total: ${findings?.length ?? 0}`);
  for (const f of findings ?? []) {
    console.log(`\n  [Art.${f.article_id}] pass=${f.detection_pass ?? f.pass_name}`);
    console.log(`  title_ar: ${f.title_ar}`);
    console.log(`  canonical_atom: ${f.canonical_atom}`);
    console.log(`  evidence_snippet: "${(f.evidence_snippet ?? '').slice(0, 200)}"`);
    console.log(`  offsets: start=${f.start_offset_global ?? f.start_offset} end=${f.end_offset_global ?? f.end_offset}`);
    console.log(`  event_id: ${f.event_id ?? 'n/a'}`);
  }
  fs.writeFileSync('job2_findings.json', JSON.stringify(findings, null, 2), 'utf-8');

  // Review findings (post-aggregation)
  console.log('\n=== REVIEW FINDINGS (analysis_review_findings) ===');
  const { data: reviewFindings } = await supabase
    .from('analysis_review_findings')
    .select('*')
    .eq('job_id', JOB_ID)
    .order('article_id');
  console.log(`Total: ${reviewFindings?.length ?? 0}`);
  for (const f of reviewFindings ?? []) {
    console.log(`\n  [Art.${f.article_id}] severity=${f.severity}`);
    console.log(`  title_ar: ${f.title_ar}`);
    console.log(`  evidence_snippet: "${(f.evidence_snippet ?? '').slice(0, 200)}"`);
    console.log(`  detection_pass: ${f.detection_pass}`);
    console.log(`  finding_uuid: ${f.finding_uuid}`);
  }

  // Run results / pass diagnostics
  console.log('\n=== CHECKING FOR PASS DIAGNOSTICS / JUDGE DIAGNOSTICS ===');
  for (const table of ['analysis_run_diagnostics', 'analysis_judge_diagnostics', 'analysis_pass_diagnostics', 'judge_diagnostics', 'run_diagnostics']) {
    const { data, error } = await supabase.from(table as any).select('id, pass_name').eq('job_id', JOB_ID).limit(5);
    if (!error && data?.length) {
      console.log(`\nTable "${table}": ${data.length} rows`);
      const { data: allRows } = await supabase.from(table as any).select('*').eq('job_id', JOB_ID);
      fs.writeFileSync(`job2_${table}.json`, JSON.stringify(allRows, null, 2), 'utf-8');
      for (const r of data) {
        console.log(`  pass_name=${r.pass_name} id=${r.id}`);
      }
    }
  }

  // Check for event understanding data  
  console.log('\n=== CHECKING EVENT UNDERSTANDING ===');
  for (const table of ['analysis_event_understanding', 'event_understanding', 'analysis_events', 'structured_events']) {
    const { data, error } = await supabase.from(table as any).select('id').eq('job_id', JOB_ID).limit(3);
    if (!error) {
      console.log(`Table "${table}": ${data?.length ?? 0} rows`);
      if (data?.length) {
        const { data: all } = await supabase.from(table as any).select('*').eq('job_id', JOB_ID);
        fs.writeFileSync(`job2_${table}.json`, JSON.stringify(all, null, 2), 'utf-8');
      }
    }
  }

  // Check for router decisions
  console.log('\n=== CHECKING ROUTER / PASS PLANNER ===');
  for (const table of ['analysis_router_logs', 'router_decisions', 'analysis_routing', 'pass_plans', 'analysis_pass_plans']) {
    const { data, error } = await supabase.from(table as any).select('id').eq('job_id', JOB_ID).limit(3);
    if (!error) {
      console.log(`Table "${table}": ${data?.length ?? 0} rows`);
      if (data?.length) {
        const { data: all } = await supabase.from(table as any).select('*').eq('job_id', JOB_ID);
        fs.writeFileSync(`job2_${table}.json`, JSON.stringify(all, null, 2), 'utf-8');
      }
    }
  }

  // Look at the config snapshot in detail
  console.log('\n=== CONFIG SNAPSHOT ===');
  console.log(JSON.stringify(job?.config_snapshot, null, 2));

  // Check if there's diagnostic_logs or lineage data in the job
  console.log('\n=== JOB DIAGNOSTIC LOGS ===');
  const diagLogs = job?.diagnostic_logs;
  if (diagLogs) {
    console.log(typeof diagLogs === 'string' ? diagLogs.slice(0, 2000) : JSON.stringify(diagLogs, null, 2).slice(0, 2000));
  } else {
    console.log('No diagnostic_logs on job record');
  }

  // Chunk text preview
  if (chunks && chunks.length > 0) {
    for (const c of chunks) {
      console.log(`\n=== CHUNK ${c.chunk_index} TEXT ===`);
      console.log(`Offsets: ${c.start_offset}-${c.end_offset}`);
      console.log('Preview:\n', (c.chunk_text ?? '').slice(0, 3000));
    }
  }
}

run().catch(console.error);
