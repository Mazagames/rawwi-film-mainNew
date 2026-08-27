import { supabase } from './src/db.js';
import fs from 'fs';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function main() {
  let output = `# Database Analysis for Job ${JOB}\n\n`;

  // 1. Chunk Runs
  const { data: runs, error: e1 } = await supabase.from('analysis_chunk_runs').select('*').eq('job_id', JOB);
  if (e1) output += `Error fetching chunk runs: ${e1.message}\n`;
  else {
    output += `## Analysis Chunk Runs (${runs?.length ?? 0})\n`;
    for (const run of runs || []) {
      output += `### Run ${run.run_key}\n`;
      output += `- ai_findings count: ${run.ai_findings?.length ?? 0}\n`;
      output += `- validated_ai_findings count: ${run.validated_ai_findings?.length ?? 0}\n`;
      output += `- truth_layer_meta: ${JSON.stringify(run.truth_layer_meta)}\n`;
      if (run.validator_audit_json) {
        output += `- validator_audit_json summary: ${JSON.stringify(run.validator_audit_json.summary)}\n`;
      }
    }
  }

  // 2. Reviewer Traces
  const { data: traces, error: e2 } = await supabase.from('analysis_reviewer_traces').select('*').eq('job_id', JOB);
  if (e2) output += `Error fetching traces: ${e2.message}\n`;
  else {
    output += `\n## Reviewer Traces (${traces?.length ?? 0})\n`;
    for (const t of traces || []) {
      if (t.validator_rejected_findings_count > 0 || t.auditor_rejected_findings_count > 0 || t.findings_count > 0) {
        output += `- Pass ${t.pass_name}:\n`;
        output += `  - findings: ${t.findings_count}\n`;
        output += `  - validator rejected: ${t.validator_rejected_findings_count}\n`;
        output += `  - auditor rejected: ${t.auditor_rejected_findings_count}\n`;
        if (t.rejected_findings_json && t.rejected_findings_json.length > 0) {
          output += `  - Rejected details:\n`;
          for (const rf of t.rejected_findings_json) {
             output += `    * [${rf.stage}] reason: ${rf.reason}, eventId: ${rf.event_id}, title: ${rf.title}\n`;
          }
        }
      }
    }
  }
  
  // 3. Pipeline finding trace
  const { data: pipelines, error: e3 } = await supabase.from('analysis_pipeline_finding_traces').select('*').eq('job_id', JOB);
  if (e3) output += `Error fetching pipeline traces: ${e3.message}\n`;
  else {
    output += `\n## Pipeline Finding Traces (${pipelines?.length ?? 0})\n`;
    for (const p of pipelines || []) {
      if (p.stage_name === 'Auditor') {
         output += `- Auditor Trace Snapshot:\n`;
         output += `  - function: ${p.function_name}\n`;
         output += `  - data: ${JSON.stringify(p.snapshot_data)}\n`;
      }
    }
  }

  fs.writeFileSync('db_analysis.md', output);
}

main().catch(console.error);
