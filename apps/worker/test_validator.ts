import { supabase } from './src/db.js';
import fs from 'fs';
import { getEventConsistencyIssue } from './src/eventConsistency.js';
import { config } from './src/config.js';
function getFindingDeclaredEventId(finding: any): number | null {
  const direct = typeof finding.event_id === "number" ? finding.event_id : null;
  if (Number.isInteger(direct) && (direct ?? 0) > 0) return direct;
  const nested = finding.location?.v3?.event_id;
  if (typeof nested === "number" && Number.isInteger(nested) && nested > 0) return nested;
  return null;
}

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const rawData = JSON.parse(fs.readFileSync('raw.json', 'utf8'));
  const aiFindings = rawData[0].raw_ai_findings || rawData[0].ai_findings || [];
  
  // Exclude notes (article_id 0) to get violations
  const violations = aiFindings.filter(f => f.article_id !== 0 && f.article_id != null);
  
  const { data: runs } = await supabase.from('analysis_chunk_runs').select('run_key').eq('job_id', JOB).limit(1);
  const chunkId = runs?.[0]?.run_key?.split(':')?.pop();
  
  let events = [];
  if (chunkId) {
    const { data: euData } = await supabase.from('analysis_event_understanding').select('events_json').eq('chunk_id', chunkId).single();
    if (euData?.events_json?.events) {
      events = euData.events_json.events;
    }
  }

  if (events.length === 0) {
    const { data: euData2 } = await supabase.from('analysis_event_understanding').select('events_json').eq('job_id', JOB).limit(1);
    if (euData2?.[0]?.events_json?.events) {
      events = euData2[0].events_json.events;
    }
  }

  let passed = 0;
  let rejected = 0;
  
  for (const f of violations) {
    const findingEventId = getFindingDeclaredEventId(f);
    
    // Simulate event consistency matching
    const eventConsistencyResult = getEventConsistencyIssue(f, events);
    const quoteEventId = eventConsistencyResult?.matchedEvent?.event_id ?? null;
    const pageEventId = quoteEventId;

    // The patched condition in pipeline.ts:
    if (
      findingEventId != null && findingEventId !== quoteEventId
    ) {
      console.log(`[REJECTED] Article ${f.article_id} - ${f.title_ar}`);
      console.log(`  findingEventId: ${findingEventId}, quoteEventId: ${quoteEventId}`);
      console.log(`  Rejection Rule: evidence_integrity_failure (Finding event id did not match...)`);
      rejected++;
    } else {
      console.log(`[PASSED] Article ${f.article_id} - ${f.title_ar}`);
      console.log(`  findingEventId: ${findingEventId}, quoteEventId: ${quoteEventId}`);
      passed++;
    }
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Total Findings: ${violations.length}`);
  console.log(`Passed Validator Event Check: ${passed}`);
  console.log(`Rejected by Validator Event Check: ${rejected}`);
}

run().catch(console.error);
