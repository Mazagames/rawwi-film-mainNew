import fs from 'fs';

const raw = JSON.parse(fs.readFileSync('raw.json', 'utf-8'));
const aiFindings = raw[0].ai_findings || [];
console.log('Total AI Findings:', aiFindings.length);

const findingsWithArticle = aiFindings.filter(f => f.article_id);
console.log('Findings with article_id:', findingsWithArticle.length);

const byArticle = {};
for (const f of aiFindings) {
  const art = f.article_id || 'unknown';
  byArticle[art] = (byArticle[art] || 0) + 1;
}
console.log('By Article:', byArticle);

const byPass = {};
for (const f of aiFindings) {
  const pass = f.detection_pass || 'unknown';
  byPass[pass] = (byPass[pass] || 0) + 1;
}
console.log('By Pass:', byPass);
