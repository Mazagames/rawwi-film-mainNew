import { supabase } from './src/db.js';
import fs from 'fs';
import { findBestEventMatch } from './src/eventConsistency.js';
import { buildValidatorAuditReport } from './src/validatorAudit.js';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data: runs } = await supabase.from('analysis_chunk_runs').select('run_key, raw_ai_findings').eq('job_id', JOB).limit(1);
  const rawFindings = runs?.[0]?.raw_ai_findings || [];
  
  const { data: chunkData } = await supabase.from('analysis_chunks').select('id, text, start_offset_global, end_offset_global').eq('job_id', JOB).limit(1);
  const chunk = chunkData?.[0];
  if (!chunk) throw new Error("No chunk found");
  
  const chunkText = chunk.text;
  const chunkId = chunk.id;
  
  let events = [];
  const { data: euData } = await supabase.from('analysis_event_understanding').select('events_json').eq('chunk_id', chunkId).limit(1);
  if (euData?.[0]?.events_json?.events) {
    events = euData[0].events_json.events;
  }
  
  const rejectedFindings = rawFindings.filter(f => f.article_id);
  const results = [];
  
  for (const rawFinding of rejectedFindings) {
    const originalEvidence = rawFinding.evidence_snippet;
    const match = findBestEventMatch(rawFinding, events);
    
    let exactScreenplayEvidence = originalEvidence;
    let appliedFix = false;
    
    if (match.matchedEvent && match.matchedScore >= 20) { 
      exactScreenplayEvidence = match.matchedEvent.quote;
      appliedFix = true;
    }
    
    const fixedFinding = {
      ...rawFinding,
      evidence_snippet: exactScreenplayEvidence,
      location: appliedFix ? {
        start_offset: match.matchedEvent.start_offset,
        end_offset: match.matchedEvent.end_offset,
        start_line: rawFinding.location?.start_line,
        end_line: rawFinding.location?.end_line,
      } : rawFinding.location
    };
    
    const passResult = { passName: rawFinding.detection_pass || 'v5_article_00', findings: [fixedFinding] };
    
    const report = buildValidatorAuditReport({
      chunkStart: chunk.start_offset_global,
      chunkEnd: chunk.end_offset_global,
      chunkText,
      eventUnderstanding: { events },
      passResults: [passResult],
      finalFindings: [],
      memory2Enabled: true,
      useEventConsistencyChecks: true
    });
    
    const rejection = report.rejectionRows[0];
    const acceptanceResult = rejection ? `Rejected (${rejection.rule})` : 'Accepted';
    
    results.push({
      article: rawFinding.article_id,
      originalEvidence: originalEvidence?.slice(0, 40) + "...",
      exactScreenplayEvidence: appliedFix ? exactScreenplayEvidence?.slice(0, 40) + "..." : "NO MATCH FOUND",
      acceptanceResult,
      score: match.matchedScore
    });
  }
  
  fs.writeFileSync('fix_trace.json', JSON.stringify(results, null, 2));
  console.log("Done");
}
run().catch(console.error);
