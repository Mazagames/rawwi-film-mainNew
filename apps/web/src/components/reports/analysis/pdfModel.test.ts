import assert from "node:assert/strict";
import { buildPdfReportCollections } from "./pdfModel";

// ---------------------------------------------------------------------------
// EXISTING TEST — preserved, must still pass
// ---------------------------------------------------------------------------

const findings = [
  {
    id: "violation-later",
    source: "ai",
    articleId: 1,
    severity: "high",
    confidence: 0.8,
    titleAr: "عنوان مخالفة",
    descriptionAr: "وصف مخالفة",
    evidenceSnippet: "دليل لاحق",
    startOffsetGlobal: 500,
    endOffsetGlobal: 510,
    startLineChunk: null,
    endLineChunk: null,
    pageNumber: 3,
    location: {},
    jobId: "job",
    scriptId: "script",
    versionId: "version",
    createdAt: "2026-01-01",
    reviewStatus: "violation" as const,
    reviewReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewedRole: null,
  },
  {
    id: "glossary",
    source: "lexicon_mandatory",
    articleId: 2,
    severity: "medium",
    confidence: 0.8,
    titleAr: "مصطلح",
    descriptionAr: "",
    evidenceSnippet: "دليل قاموس",
    startOffsetGlobal: 100,
    endOffsetGlobal: 110,
    startLineChunk: null,
    endLineChunk: null,
    pageNumber: 1,
    location: {},
    jobId: "job",
    scriptId: "script",
    versionId: "version",
    createdAt: "2026-01-01",
    reviewStatus: "violation" as const,
    reviewReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewedRole: null,
  },
  {
    id: "manual",
    source: "manual",
    articleId: 3,
    severity: "medium",
    confidence: 0.7,
    titleAr: "ملاحظة يدوية",
    descriptionAr: "",
    evidenceSnippet: "دليل يدوي",
    startOffsetGlobal: 200,
    endOffsetGlobal: 210,
    startLineChunk: null,
    endLineChunk: null,
    pageNumber: 2,
    location: {},
    jobId: "job",
    scriptId: "script",
    versionId: "version",
    createdAt: "2026-01-01",
    reviewStatus: "violation" as const,
    reviewReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewedRole: null,
  },
  {
    id: "violation-earlier",
    source: "ai",
    articleId: 1,
    severity: "high",
    confidence: 0.9,
    titleAr: "مخالفة مبكرة",
    descriptionAr: "",
    evidenceSnippet: "دليل مبكر",
    startOffsetGlobal: 20,
    endOffsetGlobal: 30,
    startLineChunk: null,
    endLineChunk: null,
    pageNumber: 1,
    location: {},
    jobId: "job",
    scriptId: "script",
    versionId: "version",
    createdAt: "2026-01-01",
    reviewStatus: "violation" as const,
    reviewReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewedRole: null,
  },
] as const;

// This test uses `findings` (no notes payload) → falls back to finding-based path.
const result = buildPdfReportCollections({
  findings: [...findings],
  notes: {
    security_scenes: [
      { id: "note-2", reviewer: null, category: "security_scenes", title: "ثانية", description: "وصف ثان", snippet: "نص ثان", event_id: 2, confidence: 0.8, status: "new", included_in_report: true },
      { id: "note-duplicate", reviewer: null, category: "security_scenes", title: "مكرر", description: "وصف ثان", snippet: "نص مكرر", event_id: 3, confidence: 0.8, status: "new", included_in_report: true },
    ],
    saudi_names: [
      { id: "note-1", reviewer: null, category: "saudi_names", title: "أولى", description: "وصف أول", snippet: "نص أول", event_id: 1, confidence: 0.8, status: "new", included_in_report: true },
    ],
  },
  lang: "ar",
});

assert.equal(result.totals.violations, 2);
assert.equal(result.totals.notes, 2);
assert.equal(result.totals.manual, 1);
assert.equal(result.totals.glossary, 1);
assert.equal(result.totals.all, 6);
assert.deepEqual(result.violations.map((card) => card.id), ["violation-earlier", "violation-later"]);
assert.ok(result.violations.every((card) => card.classification === "violation"));
assert.ok(result.notes.every((card) => card.classification === "note"));
assert.ok(result.manual.every((card) => card.classification === "manual"));
assert.ok(result.glossary.every((card) => card.classification === "glossary"));
assert.equal(result.violations[0]?.reference, "الإساءة إلى الذات الإلهية والدين");
assert.ok(!JSON.stringify(result).includes("article_01_religion"));
console.log("✓ PDF report collections preserve classification, totals, order, deduplication, and readable references");

// ---------------------------------------------------------------------------
// REGRESSION TEST — Quick Analysis: 1 review glossary + 62 canonical findings
// This reproduces the exact production failure case.
//
// Runtime payload verified from production:
//   reviewFindings = 1 (glossary)
//   canonicalFindings = 62 (40 violations + 22 notes)
//   notes = 62 (same records, keyed by article_* and non-article categories)
//   findings = 0
//
// Expected result (must match web Analysis Report banner):
//   violations = 40
//   notes = 22
//   manual = 0
//   glossary = 1
//   all = 63
// ---------------------------------------------------------------------------

// Build 40 article-category notes (→ violations in PDF)
const ARTICLE_KEYS = [
  "article_01","article_02","article_03","article_04","article_05",
  "article_06","article_07","article_08","article_09","article_10",
];
const articleNotes: Record<string, Array<{ id: string; reviewer: null; category: string; title: string; description: string; snippet: string; event_id: number; confidence: number; status: string; included_in_report: boolean }>> = {};
let noteIdx = 0;
for (const key of ARTICLE_KEYS) {
  articleNotes[key] = [];
  for (let i = 0; i < 4; i++) {
    noteIdx++;
    articleNotes[key].push({ id: `viol-${key}-${i}`, reviewer: null, category: key, title: `مخالفة ${noteIdx}`, description: `وصف مخالفة ${noteIdx}`, snippet: `نص ${noteIdx}`, event_id: noteIdx, confidence: 0.9, status: "new", included_in_report: true });
  }
}
// 40 total article notes above (10 articles × 4 = 40)

// Build 22 non-article notes (→ notes in PDF)
const NON_ARTICLE_KEYS = ["security_scenes", "saudi_names", "commercial_entities", "medical_notes", "media_credibility", "classified_documents", "religious_content"];
const informationalNotes: Record<string, Array<{ id: string; reviewer: null; category: string; title: string; description: string; snippet: string; event_id: number; confidence: number; status: string; included_in_report: boolean }>> = {};
let noteIdx2 = 0;
for (const key of NON_ARTICLE_KEYS) {
  informationalNotes[key] = [];
  const count = key === "security_scenes" ? 4 : key === "saudi_names" ? 4 : key === "commercial_entities" ? 4 : key === "medical_notes" ? 3 : key === "media_credibility" ? 3 : key === "classified_documents" ? 2 : 2;
  for (let i = 0; i < count; i++) {
    noteIdx2++;
    informationalNotes[key].push({ id: `note-${key}-${i}`, reviewer: null, category: key, title: `ملاحظة ${noteIdx2}`, description: `وصف ملاحظة ${noteIdx2}`, snippet: `نص ملاحظة ${noteIdx2}`, event_id: 1000 + noteIdx2, confidence: 0.8, status: "new", included_in_report: true });
  }
}
// 22 total: 4+4+4+3+3+2+2 = 22

// 1 review glossary finding
const qaReviewFindings = [
  {
    id: "review-glossary-1",
    canonicalFindingId: null,
    sourceKind: "glossary" as const,
    titleAr: "مصطلح المعجم",
    descriptionAr: "وصف معجمي",
    rationaleAr: null,
    manualComment: null,
    evidenceSnippet: "نص معجم",
    primaryArticleId: null,
    pageNumber: null,
    startOffsetGlobal: null,
    anchorConfidence: null,
    includeInReport: true,
    isHidden: false,
    reviewStatus: "violation" as const,
    reviewReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewedRole: null,
    atomId: null,
    primaryAtomId: null,
  },
];

// 62 canonical findings — 40 of severity "high" (violations) + 22 of severity "note"
const qaCanonicalFindings = [
  ...Array.from({ length: 40 }, (_, i) => ({
    canonical_finding_id: `canonical-viol-${i}`,
    title_ar: `مخالفة قانونية ${i + 1}`,
    evidence_snippet: `دليل ${i + 1}`,
    severity: "high",
    confidence: 0.9,
    source: "ai",
    primary_article_id: (i % 10) + 1,
  })),
  ...Array.from({ length: 22 }, (_, i) => ({
    canonical_finding_id: `canonical-note-${i}`,
    title_ar: `ملاحظة قانونية ${i + 1}`,
    evidence_snippet: `دليل ملاحظة ${i + 1}`,
    severity: "note",
    confidence: 0.7,
    source: "ai",
    primary_article_id: null,
  })),
];

const qaResult = buildPdfReportCollections({
  findings: [],                              // findings = 0
  reviewFindings: qaReviewFindings as unknown as Parameters<typeof buildPdfReportCollections>[0]["reviewFindings"],
  canonicalFindings: qaCanonicalFindings,   // 62 canonical findings (not primary source when notes present)
  notes: {
    ...articleNotes,
    ...informationalNotes,
  } as Parameters<typeof buildPdfReportCollections>[0]["notes"],
  lang: "ar",
});

// Core correctness assertions
assert.equal(qaResult.totals.violations, 40, `Expected 40 violations, got ${qaResult.totals.violations}`);
assert.equal(qaResult.totals.notes, 22, `Expected 22 notes, got ${qaResult.totals.notes}`);
assert.equal(qaResult.totals.manual, 0, `Expected 0 manual, got ${qaResult.totals.manual}`);
assert.equal(qaResult.totals.glossary, 1, `Expected 1 glossary, got ${qaResult.totals.glossary}`);
assert.equal(qaResult.totals.all, 63, `Expected 63 total, got ${qaResult.totals.all}`);

// Classification integrity
assert.ok(qaResult.violations.every(c => c.classification === "violation"), "All violations must have classification=violation");
assert.ok(qaResult.notes.every(c => c.classification === "note"), "All notes must have classification=note");
assert.ok(qaResult.glossary.every(c => c.classification === "glossary"), "All glossary must have classification=glossary");

// No cross-contamination
assert.ok(!qaResult.violations.some(c => c.classification === "note"), "Violations must not contain notes");
assert.ok(!qaResult.notes.some(c => c.classification === "violation"), "Notes must not contain violations");

// Glossary item is present
assert.equal(qaResult.glossary.length, 1);
assert.equal(qaResult.glossary[0]?.id, "review-glossary-1");

// Canonical 62 findings are NOT discarded (they are represented via notes payload)
assert.equal(qaResult.violations.length + qaResult.notes.length, 62, "40 violations + 22 notes = 62 from canonical payload");

// 1 review finding does NOT suppress the canonical 62
assert.ok(qaResult.totals.all === 63, "Single review glossary must NOT suppress canonical 62");

console.log(`✓ Quick Analysis regression: violations=${qaResult.totals.violations}, notes=${qaResult.totals.notes}, manual=${qaResult.totals.manual}, glossary=${qaResult.totals.glossary}, all=${qaResult.totals.all}`);
console.log("✓ Classification integrity verified: no cross-contamination between buckets");
console.log("✓ 1 review glossary finding did not suppress 62 canonical findings");
