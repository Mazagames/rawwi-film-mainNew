import assert from 'node:assert/strict';
import { getCanonicalReportTotals } from './reportSummaryTotals';

const totals = getCanonicalReportTotals({
  totals: {
    findings_count: 10,
    severity_counts: { low: 1, medium: 2, high: 3, critical: 4 },
    type_counts: { ai: 4, manual: 1, glossary: 2, special: 3 },
  },
  notes: {
    article_05: [{ id: 'n1' }],
    article_12: [{ id: 'n2' }],
  },
}, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });

assert.equal(totals.violations, 10);
assert.equal(totals.notes, 2);
assert.equal(totals.all, 12);
assert.equal(totals.manual, 1);
assert.equal(totals.glossary, 2);
assert.equal(totals.special, 3);
assert.equal(totals.ai, 4);

const fallback = getCanonicalReportTotals(undefined, { fallbackFindingsCount: 77, fallbackTypeCounts: { ai: 5, manual: 6, glossary: 7, special: 8 } });
assert.equal(fallback.violations, 77);
assert.equal(fallback.notes, 0);
assert.equal(fallback.all, 77);
assert.equal(fallback.manual, 6);
assert.equal(fallback.glossary, 7);
assert.equal(fallback.special, 8);
assert.equal(fallback.ai, 5);

console.log('✓ report summary totals contract uses canonical summary totals');
