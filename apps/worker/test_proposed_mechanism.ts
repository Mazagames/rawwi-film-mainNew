import { supabase } from './src/db.js';
import fs from 'fs';
import { findBestEventMatch } from './src/eventConsistency.js';
import { buildValidatorAuditReport } from './src/validatorAudit.js';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const rawData = JSON.parse(fs.readFileSync('raw.json', 'utf8'));
  const aiFindings = rawData[0].raw_ai_findings || rawData[0].ai_findings || [];
  const rejectedFindings = aiFindings.filter(f => f.article_id);
  
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
    // If no events found by chunk_id, try by job_id just in case
    const { data: euData2 } = await supabase.from('analysis_event_understanding').select('events_json').eq('job_id', JOB).limit(1);
    if (euData2?.[0]?.events_json?.events) {
      events = euData2[0].events_json.events;
    }
  }

  // Construct mock chunk text containing all event quotes so grounding succeeds
  const mockChunkText = events.map(e => e.quote).join('\n\n') + " Mock chunk text fallback";
  
  const results = [];
  
  for (const rawFinding of rejectedFindings) {
    const originalEvidence = rawFinding.evidence_snippet;
    const match = findBestEventMatch(rawFinding, events);
    
    let exactScreenplayEvidence = originalEvidence;
    let appliedFix = false;
    
    // Propose deterministic post-processing step
    // If we have a semantic match to an event (score >= 20)
    if (match.matchedEvent && match.matchedScore >= 20) { 
      exactScreenplayEvidence = match.matchedEvent.quote;
      appliedFix = true;
    }
    
    const fixedFinding = {
      ...rawFinding,
      evidence_snippet: exactScreenplayEvidence,
      location: appliedFix ? {
        ...rawFinding.location,
        start_offset: mockChunkText.indexOf(exactScreenplayEvidence),
        end_offset: mockChunkText.indexOf(exactScreenplayEvidence) + exactScreenplayEvidence.length,
      } : rawFinding.location
    };
    
    const passResult = { passName: rawFinding.detection_pass || 'v5_article_00', findings: [fixedFinding] };
    
    const report = buildValidatorAuditReport({
      chunkStart: 0,
      chunkEnd: mockChunkText.length,
      chunkText: mockChunkText,
      eventUnderstanding: { events },
      passResults: [passResult],
      finalFindings: [],
      memory2Enabled: true,
      useEventConsistencyChecks: true
    });
    
    const rejection = report.rejectionRows[0];
    const acceptanceResult = rejection ? `Rejected (${rejection.rule})` : 'Accepted';
    
    results.push({
      originalGeminiEvidence: originalEvidence,
      exactScreenplayEvidence: appliedFix ? exactScreenplayEvidence : "NO EVENT MATCH FOUND",
      article: rawFinding.article_id,
      acceptanceResult: acceptanceResult,
      matchedScore: match.matchedScore
    });
  }
  
  fs.writeFileSync('mechanism_results.json', JSON.stringify(results, null, 2));
  console.log("Done. Results saved to mechanism_results.json");
}
run().catch(console.error);
