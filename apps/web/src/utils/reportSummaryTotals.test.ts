import assert from 'node:assert/strict';
import {
  getCanonicalReportTotals,
  countInformationalNotesInSummary,
  countArticleNotesInSummary,
} from './reportSummaryTotals';

// ---------------------------------------------------------------------------
// countArticleNotesInSummary / countInformationalNotesInSummary helpers
// ---------------------------------------------------------------------------
const mixedNotes = {
  article_05: [{ id: 'a1' }, { id: 'a2' }],
  article_12: [{ id: 'a3' }],
  security_scenes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
  saudi_names: [{ id: 'n4' }],
};
assert.equal(countArticleNotesInSummary(mixedNotes), 3, 'article notes = 3');
assert.equal(countInformationalNotesInSummary(mixedNotes), 4, 'informational notes = 4');
assert.equal(countArticleNotesInSummary(undefined), 0, 'undefined notes → 0');
assert.equal(countInformationalNotesInSummary(undefined), 0, 'undefined notes → 0');

// ---------------------------------------------------------------------------
// TEST 1: Modern report — violations from article_* notes
// Article notes take priority over findings_count when present.
// ---------------------------------------------------------------------------
const totals = getCanonicalReportTotals({
  totals: {
    findings_count: 10,
    type_counts: { ai: 4, manual: 1, glossary: 2, special: 3 },
  },
  notes: {
    article_05: [{ id: 'n1' }],  // 1 violation
    article_12: [{ id: 'n2' }],  // 1 violation
    // no informational notes → notes = 0
  },
}, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });

// articleNotesCount = 2 → preferred over findings_count (10)
assert.equal(totals.violations, 2, 'violations = article_* count');
assert.equal(totals.notes, 0, 'notes = 0 (no non-article notes)');
assert.equal(totals.all, 2);
assert.equal(totals.manual, 1);
assert.equal(totals.glossary, 2);
assert.equal(totals.special, 3);
assert.equal(totals.ai, 4);

// ---------------------------------------------------------------------------
// TEST 2: No notes at all — fallback to fallbackFindingsCount
// ---------------------------------------------------------------------------
const fallback = getCanonicalReportTotals(undefined, {
  fallbackFindingsCount: 77,
  fallbackTypeCounts: { ai: 5, manual: 6, glossary: 7, special: 8 },
});
assert.equal(fallback.violations, 77);
assert.equal(fallback.notes, 0);
assert.equal(fallback.all, 77);
assert.equal(fallback.manual, 6);
assert.equal(fallback.glossary, 7);
assert.equal(fallback.special, 8);
assert.equal(fallback.ai, 5);

// ---------------------------------------------------------------------------
// TEST 3: canonicalFindingCount option override takes highest priority
// ---------------------------------------------------------------------------
const canonicalOverride = getCanonicalReportTotals({
  totals: {
    findings_count: 10,
    type_counts: { ai: 4, manual: 1, glossary: 2, special: 3 },
  },
  notes: {
    article_05: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
    security_scenes: [{ id: 's1' }, { id: 's2' }],
  },
}, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } }, { canonicalFindingCount: 1 });
// option override wins regardless of articleNotes
assert.equal(canonicalOverride.violations, 1);
// notes = informational only = security_scenes = 2
assert.equal(canonicalOverride.notes, 2);
assert.equal(canonicalOverride.all, 3);

// ---------------------------------------------------------------------------
// TEST 4: context_metrics.violation_count — only used when no article notes
// ---------------------------------------------------------------------------
const noArticleNotes = getCanonicalReportTotals({
  totals: {
    findings_count: 7,
    type_counts: { ai: 4, manual: 0, glossary: 1, special: 0 },
  },
  context_metrics: {
    violation_count: 5,
  },
  canonical_findings: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
  notes: {
    // only informational notes — no article_* → fallback to context_metrics
    security_scenes: [{ id: 's1' }, { id: 's2' }],
  },
}, { fallbackFindingsCount: 99, fallbackTypeCounts: { ai: 99, manual: 99, glossary: 99, special: 99 } });
// No article notes → use context_metrics.violation_count = 5
assert.equal(noArticleNotes.violations, 5);
assert.equal(noArticleNotes.notes, 2); // informational notes only
assert.equal(noArticleNotes.all, 7);

// ---------------------------------------------------------------------------
// TEST 5: Exact production case — web: violations=65, notes=31, glossary=2
// Workspace Reports card must produce the same counts.
// ---------------------------------------------------------------------------
const productionNotes: Record<string, Array<{ id: string }>> = {};
// 65 article-category violations
const ARTICLE_KEYS_65 = [
  'article_01','article_02','article_03','article_04','article_05',
  'article_06','article_07','article_08','article_09','article_10',
  'article_11','article_12','article_13',
];
let vIdx = 0;
for (const key of ARTICLE_KEYS_65) {
  const count = Math.floor(65 / ARTICLE_KEYS_65.length) + (vIdx < 65 % ARTICLE_KEYS_65.length ? 1 : 0);
  productionNotes[key] = Array.from({ length: count }, (_, i) => ({ id: `${key}-${i}` }));
  vIdx++;
}
// 31 informational notes
const INFO_KEYS_31 = ['security_scenes','saudi_names','commercial_entities','medical_notes','religious_content'];
let nIdx = 0;
for (const key of INFO_KEYS_31) {
  const count = Math.floor(31 / INFO_KEYS_31.length) + (nIdx < 31 % INFO_KEYS_31.length ? 1 : 0);
  productionNotes[key] = Array.from({ length: count }, (_, i) => ({ id: `${key}-${i}` }));
  nIdx++;
}

const articleTotal = Object.entries(productionNotes).filter(([k]) => k.startsWith('article_')).reduce((s, [, v]) => s + v.length, 0);
const infoTotal = Object.entries(productionNotes).filter(([k]) => !k.startsWith('article_')).reduce((s, [, v]) => s + v.length, 0);
assert.equal(articleTotal, 65, `Expected 65 article notes, got ${articleTotal}`);
assert.equal(infoTotal, 31, `Expected 31 info notes, got ${infoTotal}`);

const productionResult = getCanonicalReportTotals({
  notes: productionNotes,
  canonical_findings: [], // empty
  context_metrics: { violation_count: 0 },
  totals: { findings_count: 0, type_counts: { ai: 0, manual: 0, glossary: 2, special: 0 } },
}, {});

assert.equal(productionResult.violations, 65, `Expected 65 violations, got ${productionResult.violations}`);
assert.equal(productionResult.notes, 31, `Expected 31 notes, got ${productionResult.notes}`);
assert.equal(productionResult.all, 96, `Expected 96 all, got ${productionResult.all}`);
assert.equal(productionResult.glossary, 2);

console.log('✓ countArticleNotesInSummary / countInformationalNotesInSummary helpers correct');
console.log('✓ report summary totals: article_* notes → violations, non-article → notes');
console.log('✓ fallback chain: options > articleNotes > context_metrics > canonical_findings > summary.totals');
console.log(`✓ Production case: violations=${productionResult.violations}, notes=${productionResult.notes}, all=${productionResult.all}, glossary=${productionResult.glossary}`);
