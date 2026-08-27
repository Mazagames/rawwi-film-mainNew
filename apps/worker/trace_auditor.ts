import { supabase } from './src/db.js';
import fs from 'fs';
import { findBestEventMatch } from './src/eventConsistency.js';
import { buildValidatorAuditReport } from './src/validatorAudit.js';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';
const CHUNK_ID = 'cc18174d-69b0-4f09-8fdb-35bdbe807706';

async function run() {
  const rawData = JSON.parse(fs.readFileSync('raw.json', 'utf8'));
  const aiFindings = rawData[0].ai_findings || [];
  const findingsWithArticle = aiFindings.filter(f => f.article_id);
  
  const { data: chunk } = await supabase.from('analysis_chunks').select('text, start_offset_global, end_offset_global').eq('id', CHUNK_ID).single();
  if (!chunk) return console.error('Chunk not found');
  
  const chunkText = chunk.text;
  
  let events = [];
  const { data: euData } = await supabase.from('analysis_event_understanding').select('events_json').eq('chunk_id', CHUNK_ID).single();
  if (euData?.events_json?.events) {
    events = euData.events_json.events;
  }
  
  const results = [];
  
  for (const finding of findingsWithArticle) {
    const match = findBestEventMatch(finding, events);
    const passResult = { passName: finding.detection_pass || 'v5_article_00', findings: [finding] };
    
    const report = buildValidatorAuditReport({
      chunkStart: chunk.start_offset_global,
      chunkEnd: chunk.end_offset_global,
      chunkText: chunkText,
      eventUnderstanding: { events },
      passResults: [passResult],
      finalFindings: [],
      memory2Enabled: true,
      useEventConsistencyChecks: true 
    });
    
    const rejectionRow = report.rejectionRows[0];
    
    results.push({
      article_id: finding.article_id,
      finding_uuid: finding.finding_uuid,
      event_id_before_auditor: finding.event_id ?? null,
      matched_structured_event_id: match.matchedEvent?.event_id ?? null,
      rejection_rule: rejectionRow?.rule || 'None',
      rejection_reason: rejectionRow?.rejectionReason || 'None',
    });
  }
  
  fs.writeFileSync('auditor_trace_final.json', JSON.stringify(results, null, 2));
  console.log('Done writing auditor_trace_final.json');
}

run().catch(console.error);
