import fs from 'fs';
import { getEventConsistencyIssue } from './src/eventConsistency.js';
import { groundFindingEvidenceToChunk } from './src/evidenceGrounding.js';

const chunkText = fs.readFileSync('job2_fulltext.txt', 'utf-8');
const events = [
  { event_id: 8, event_summary: 'المشهد 1', quote: 'وأنتِ… لا تتفلسفين. فاهمة؟ إذا رفعتِ صوتك، بقوم آخذ الجزمة وأضربك فيها.', start_offset: 494, end_offset: 567 },
  { event_id: 17, event_summary: 'المشهد 7', quote: 'تتألم؟ ألمك بسيط. اللي ما يفهم بالكلام… يفهم بالضرب.', start_offset: 1391, end_offset: 1443 }
];

const cases = [
  { article: 5, event_id: 8, evidence: 'بقوم آخذ الجزمة وأضربك فيها' },
  { article: 5, event_id: 17, evidence: 'اللي ما يفهم بالكلام… يفهم بالضرب' },
  { article: 14, event_id: 8, evidence: 'لا تتفلسفين' },
];

for (const c of cases) {
  console.log('--- ' + c.evidence + ' ---');
  const ev = events.find(e => e.event_id === c.event_id);
  
  const eventStart = chunkText.indexOf(ev.quote);
  const eventEnd = eventStart + ev.quote.length;
  ev.start_offset = eventStart;
  ev.end_offset = eventEnd;
  console.log('event.raw start/end:', eventStart, '/', eventEnd);
  
  let finding = {
    article_id: c.article,
    event_id: c.event_id,
    evidence_snippet: c.evidence,
    location: null
  };
  const grounded = groundFindingEvidenceToChunk(finding, chunkText, 0, chunkText.length);
  console.log('grounded method:', grounded.method);
  console.log('finding local start/end:', grounded.finding.location?.start_offset, '/', grounded.finding.location?.end_offset);
  
  const evidenceAlignedFinding = { ...grounded.finding, evidence_snippet: ev.quote };
  
  const issue = getEventConsistencyIssue(evidenceAlignedFinding, events);
  console.log('issue:', issue.issue);
}
