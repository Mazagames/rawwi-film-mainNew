import 'dotenv/config';
import { supabase } from './src/db.js';
import * as fs from 'fs';

const JOB = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';

async function trace() {
  console.log(`Fetching logs for ${JOB}...`);
  const { data: logs, error } = await supabase
    .from('analysis_logs')
    .select('*')
    .eq('job_id', JOB)
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  console.log(`Got ${logs.length} logs.`);
  
  // Find a log indicating Judge request prepared or Judge response received for v5_article_12 or v5_article_14
  // The multiPassJudge logs pass results
  
  let targetChunkId = null;
  let targetArticle = null;
  
  const relevantLogs = logs.filter(l => 
    (l.message.includes('Judge request prepared') || 
     l.message.includes('Judge response received') ||
     l.message.includes('Judge parse succeeded') ||
     l.message.includes('Judge Call Diagnostics')) && 
     (JSON.stringify(l.metadata || {}).includes('v5_article_14') || JSON.stringify(l.metadata || {}).includes('v5_article_12'))
  );

  console.log(`Found ${relevantLogs.length} highly relevant logs for Article 12/14.`);

  const mdLines = [];
  mdLines.push(`# Trace for Job ${JOB} (Article 12/14)`);

  for (const log of logs) {
    const metaStr = JSON.stringify(log.metadata || {});
    if (log.message.includes('Judge request prepared') && (metaStr.includes('v5_article_14') || metaStr.includes('v5_article_12') || log.metadata?.articleId === 12 || log.metadata?.articleId === 14)) {
      mdLines.push(`## Request Prepared`);
      mdLines.push(`\`\`\`json\n${JSON.stringify(log.metadata, null, 2)}\n\`\`\``);
    }
    
    if (log.message.includes('Judge Call Diagnostics') && (metaStr.includes('v5_article_14') || metaStr.includes('v5_article_12'))) {
      mdLines.push(`## Judge Call Diagnostics`);
      mdLines.push(`\`\`\`json\n${JSON.stringify(log.metadata, null, 2)}\n\`\`\``);
    }
    
    if (log.message.includes('Judge parse succeeded') && (metaStr.includes('v5_article_14') || metaStr.includes('v5_article_12'))) {
      mdLines.push(`## Judge Parse Succeeded`);
      mdLines.push(`\`\`\`json\n${JSON.stringify(log.metadata, null, 2)}\n\`\`\``);
    }
    
    if (log.message.includes('Pass') && log.message.includes('completed') && (metaStr.includes('v5_article_14') || metaStr.includes('v5_article_12'))) {
      mdLines.push(`## Pass Completed`);
      mdLines.push(`\`\`\`json\n${JSON.stringify(log.metadata, null, 2)}\n\`\`\``);
    }
  }

  // Check the run traces
  const { data: runs } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('job_id', JOB);
    
  if (runs) {
    for (const run of runs) {
      if (run.trace_dump) {
        mdLines.push(`## Trace Dump (Pass Breakdown)`);
        mdLines.push(`\`\`\`json\n${JSON.stringify(run.trace_dump, null, 2)}\n\`\`\``);
      }
    }
  }

  // Fetch the actual reviewer traces which contain raw responses
  const { data: traces } = await supabase
    .from('analysis_reviewer_traces')
    .select('*')
    .eq('job_id', JOB);
    
  if (traces) {
    for (const t of traces) {
      if (t.pass_name === 'v5_article_12' || t.pass_name === 'v5_article_14') {
        mdLines.push(`## Reviewer Trace: ${t.pass_name}`);
        mdLines.push(`**Provider:** ${t.provider || 'unknown'}`);
        mdLines.push(`**Model:** ${t.model || 'unknown'}`);
        mdLines.push(`**Hash (System):** ${t.system_prompt_hash}`);
        mdLines.push(`**Hash (User):** ${t.user_prompt_hash}`);
        mdLines.push(`### Raw Response`);
        mdLines.push(`\`\`\`json\n${t.raw_response_body}\n\`\`\``);
        mdLines.push(`### Parsed Output`);
        mdLines.push(`\`\`\`json\n${JSON.stringify(t.parsed_output, null, 2)}\n\`\`\``);
      }
    }
  }

  fs.writeFileSync('gpt41_trace_report.md', mdLines.join('\n\n'));
  console.log("Wrote gpt41_trace_report.md");
}

trace().catch(console.error);
