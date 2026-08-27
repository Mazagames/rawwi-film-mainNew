import { supabase } from './src/db.js';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data: runs, error } = await supabase
    .from('analysis_chunk_runs')
    .select('run_key, ai_findings, validated_ai_findings, truth_layer_meta, created_at')
    .eq('job_id', JOB)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching runs:', error);
    return;
  }
  
  console.log(`Found ${runs?.length ?? 0} runs.`);

  for (const run of runs ?? []) {
    const aiCount = run.ai_findings?.length ?? 0;
    const valCount = run.validated_ai_findings?.length ?? 0;
    console.log(`\nRun: ${run.run_key}`);
    console.log(` - ai_findings: ${aiCount}`);
    console.log(` - validated_ai_findings: ${valCount}`);
    console.log(` - truth_layer_meta:`, JSON.stringify(run.truth_layer_meta, null, 2));
    
    if (run.validated_ai_findings) {
      console.log('   -> Validator Findings:');
      for (const f of run.validated_ai_findings) {
        console.log(`      - finding_uuid: ${f.finding_uuid}, article_id: ${f.article_id}, event_id: ${f.event_id}, title: ${f.title_ar}, final_ruling: ${f.final_ruling}, evidence: ${f.evidence_snippet?.slice(0, 50)}`);
      }
    }
  }

  const { data: euData } = await supabase
    .from('analysis_event_understanding')
    .select('events_json')
    .eq('job_id', JOB);
  
  console.log(`\nFound ${euData?.length ?? 0} Event Understanding rows.`);
  for (const row of euData ?? []) {
    console.log('Events in DB:', row.events_json?.length);
  }
  
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
