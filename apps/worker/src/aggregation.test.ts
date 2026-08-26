/**
 * Tests for report aggregation: taxonomy order, dedup, article 26 excluded.
 * Run: npx tsx src/aggregation.test.ts (from apps/worker or repo root)
 */
import { buildSummaryJson, isArticleNoteCanonicalFindingId } from "./aggregation.js";
import { getPolicyArticles } from "./policyMap.js";

type DbFinding = {
  source?: string;
  article_id: number;
  atom_id: string | null;
  severity: string;
  confidence: number | null;
  title_ar: string;
  description_ar: string;
  evidence_snippet: string;
  start_offset_global: number | null;
  end_offset_global: number | null;
  start_line_chunk: number | null;
  end_line_chunk: number | null;
  location: unknown;
};

type DbNote = {
  reviewer: string;
  category: string;
  title: string;
  description: string;
  snippet: string;
  event_id: number;
  confidence: number;
  status?: string;
  included_in_report?: boolean;
  created_at?: string | null;
};

function buildNote(overrides: Partial<DbNote> = {}): DbNote {
  return {
    reviewer: "article_14_profanity_personal_insults",
    category: "article_14",
    title: "ملاحظة",
    description: "ملاحظة ليست مخالفة",
    snippet: "اقتباس",
    event_id: 22,
    confidence: 0.95,
    status: "new",
    included_in_report: true,
    ...overrides,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Policy order: article ids in PolicyMap order (1..24 for scannable, no 26)
function testArticleOrder() {
  const policyArticles = getPolicyArticles().filter((a) => a.articleId !== 26);
  const expectedIds = policyArticles.map((a) => a.articleId);
  const findings: DbFinding[] = [
    { article_id: 8, atom_id: "8-1", severity: "low", confidence: 0.9, title_ar: "x", description_ar: "", evidence_snippet: "a", start_offset_global: 0, end_offset_global: 1, start_line_chunk: null, end_line_chunk: null, location: {} },
    { article_id: 5, atom_id: "5-1", severity: "medium", confidence: 0.8, title_ar: "y", description_ar: "", evidence_snippet: "b", start_offset_global: 10, end_offset_global: 11, start_line_chunk: null, end_line_chunk: null, location: {} },
    { article_id: 5, atom_id: "5-2", severity: "low", confidence: 0.7, title_ar: "z", description_ar: "", evidence_snippet: "c", start_offset_global: 20, end_offset_global: 21, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  const gotIds = summary.findings_by_article.map((a) => a.article_id);
  const sortedExpected = [...gotIds].sort((a, b) => a - b);
  assert(
    JSON.stringify(gotIds) === JSON.stringify(sortedExpected),
    `findings_by_article should be sorted by article_id asc; got ${JSON.stringify(gotIds)}`
  );
  assert(
    summary.findings_by_article[0].article_id === 5 && summary.findings_by_article[1].article_id === 8,
    "Order should be 5 then 8 (policy/article id asc)"
  );
  console.log("✓ Article/atom order follows policyMap (articleId asc)");
}

// Dedup: same source+article+atom+span+snippet → one finding, highest severity kept
function testDedup() {
  const snippet = "same evidence text";
  const findings: DbFinding[] = [
    { source: "ai", article_id: 5, atom_id: "5-1", severity: "low", confidence: 0.5, title_ar: "a", description_ar: "", evidence_snippet: snippet, start_offset_global: 0, end_offset_global: 10, start_line_chunk: null, end_line_chunk: null, location: {} },
    { source: "ai", article_id: 5, atom_id: "5-1", severity: "high", confidence: 0.9, title_ar: "b", description_ar: "", evidence_snippet: snippet, start_offset_global: 0, end_offset_global: 10, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  assert(summary.totals.findings_count === 1, `Dedup: expected 1 finding, got ${summary.totals.findings_count}`);
  assert(summary.totals.severity_counts.high === 1, "Dedup: should keep highest severity (high)");
  console.log("✓ Dedup: duplicates removed, highest severity kept");
}

function testDedupPrefersHigherConfidenceOnSameSeverity() {
  const snippet = "same evidence text with same severity";
  const findings: DbFinding[] = [
    { source: "ai", article_id: 5, atom_id: "5-1", severity: "medium", confidence: 0.4, title_ar: "a", description_ar: "", evidence_snippet: snippet, start_offset_global: 0, end_offset_global: 10, start_line_chunk: null, end_line_chunk: null, location: {} },
    { source: "ai", article_id: 5, atom_id: "5-1", severity: "medium", confidence: 0.95, title_ar: "b", description_ar: "", evidence_snippet: snippet, start_offset_global: 0, end_offset_global: 10, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  const topFinding = summary.findings_by_article[0]?.top_findings[0];
  assert(summary.totals.findings_count === 1, `Dedup: expected 1 finding, got ${summary.totals.findings_count}`);
  assert(topFinding?.confidence === 0.95, `Dedup: expected higher confidence to win, got ${topFinding?.confidence}`);
  console.log("✓ Dedup: higher confidence wins when severity ties");
}

// Article 26 excluded from report
function testArticle26Excluded() {
  const findings: DbFinding[] = [
    { article_id: 26, atom_id: null, severity: "critical", confidence: 1, title_ar: "out", description_ar: "", evidence_snippet: "x", start_offset_global: 0, end_offset_global: 1, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  assert(summary.totals.findings_count === 0, "Article 26 should be excluded from report");
  assert(summary.findings_by_article.length === 0, "No findings_by_article for 26");
  console.log("✓ Article 26 (out-of-scope) excluded from report");
}

// Source badge labels (conceptual: we only test that summary builds; badge is UI)
function testSummaryHasFindingsByArticle() {
  const findings: DbFinding[] = [
    { source: "manual", article_id: 5, atom_id: "5-1", severity: "medium", confidence: 1, title_ar: "ملاحظة يدوية", description_ar: "", evidence_snippet: "m", start_offset_global: 0, end_offset_global: 1, start_line_chunk: null, end_line_chunk: null, location: {} },
    { source: "ai", article_id: 5, atom_id: "5-2", severity: "low", confidence: 0.8, title_ar: "AI", description_ar: "", evidence_snippet: "ai", start_offset_global: 2, end_offset_global: 3, start_line_chunk: null, end_line_chunk: null, location: {} },
    { source: "lexicon_mandatory", article_id: 8, atom_id: "8-1", severity: "high", confidence: 1, title_ar: "قاموس", description_ar: "", evidence_snippet: "lex", start_offset_global: 5, end_offset_global: 6, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  assert(summary.totals.findings_count === 3, "All three sources should appear");
  assert(summary.findings_by_article.some((a) => a.article_id === 5) && summary.findings_by_article.some((a) => a.article_id === 8), "Articles 5 and 8 present");
  console.log("✓ Summary includes findings from AI, manual, glossary (sources for badge)");
}

function testCrossArticleOverlapKeepsOwnershipSeparate() {
  const sharedSpan = {
    start_offset_global: 10,
    end_offset_global: 20,
    start_line_chunk: null,
    end_line_chunk: null,
    location: {},
  };
  const findings: DbFinding[] = [
    { source: "ai", article_id: 5, atom_id: "5-1", severity: "medium", confidence: 0.9, title_ar: "A", description_ar: "", evidence_snippet: "shared", ...sharedSpan },
    { source: "ai", article_id: 8, atom_id: "8-1", severity: "high", confidence: 0.95, title_ar: "B", description_ar: "", evidence_snippet: "shared", ...sharedSpan },
  ];
  const summary = buildSummaryJson("job1", "script1", findings);
  const articleIds = summary.findings_by_article.map((item) => item.article_id).sort((a, b) => a - b);
  assert(JSON.stringify(articleIds) === JSON.stringify([5, 8]), `expected separate ownership for articles 5 and 8, got ${JSON.stringify(articleIds)}`);
  const article5 = summary.findings_by_article.find((item) => item.article_id === 5);
  const article8 = summary.findings_by_article.find((item) => item.article_id === 8);
  assert((article5?.top_findings[0]?.primary_article_id ?? 0) === 5, "article 5 should remain owner of its finding");
  assert((article8?.top_findings[0]?.primary_article_id ?? 0) === 8, "article 8 should remain owner of its finding");
  console.log("✓ Cross-article overlaps keep article ownership separate");
}

function testNotesAreGroupedSeparately() {
  const findings: DbFinding[] = [
    { article_id: 5, atom_id: "5-1", severity: "medium", confidence: 0.9, title_ar: "x", description_ar: "", evidence_snippet: "a", start_offset_global: 0, end_offset_global: 1, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const notes: DbNote[] = [
    {
      reviewer: "note_saudi_names",
      category: "Saudi Names",
      title: "اسم",
      description: "وصف",
      snippet: "فقرة",
      event_id: 12,
      confidence: 0.8,
      status: "new",
      included_in_report: true,
    },
    {
      reviewer: "notes_security_scenes",
      category: "Security Scenes",
      title: "مشهد",
      description: "وصف آخر",
      snippet: "فقرة أخرى",
      event_id: 13,
      confidence: 0.7,
      included_in_report: false,
    },
    {
      reviewer: "notes_security_scenes",
      category: "security_scenes",
      title: "مشهد آخر",
      description: "وصف جديد",
      snippet: "فقرة ثالثة",
      event_id: 14,
      confidence: 0.9,
      status: "new",
      included_in_report: false,
    }
  ];
  const summary = buildSummaryJson("job1", "script1", findings, undefined, undefined, undefined, undefined, notes);
  assert(Array.isArray(summary.notes_summary), "notes_summary should exist");
  assert((summary.notes?.saudi_names ?? []).length === 1, "Saudi names note should be grouped separately");
  assert((summary.notes?.security_scenes ?? []).length === 2, "Security scenes should contain 2 notes for multiple events");
  assert(summary.notes_summary?.some((group) => group.category === "saudi_names"), "notes_summary should include saudi_names");
  assert(summary.notes_summary?.some((group) => group.category === "security_scenes"), "notes_summary should include security_scenes");

  // Also verify Religious Content UI Mapping
  const religiousNotes: DbNote[] = [
    {
      reviewer: "note_religious_content",
      category: "religious_content",
      title: "محتوى ديني",
      description: "وصف",
      snippet: "اقتباس",
      event_id: 5,
      confidence: 0.9,
      status: "new"
    }
  ];
  const religiousSummary = buildSummaryJson("job2", "script2", findings, undefined, undefined, undefined, undefined, religiousNotes);
  assert((religiousSummary.notes?.religious_content ?? []).length === 1, "Religious notes should be mapped to religious_content");
  assert(religiousSummary.notes_summary?.some((group) => group.category === "religious_content"), "notes_summary should include religious_content");

  const article05And12Notes: DbNote[] = [
    { reviewer: "article_05_violence_torture", category: "article_05", title: "عنف", description: "وصف", snippet: "دليل", event_id: 30, confidence: 0.9, status: "new" },
    { reviewer: "article_12_child_protection_exploitation", category: "article_12", title: "قاصر", description: "وصف", snippet: "دليل", event_id: 31, confidence: 0.9, status: "new" },
  ];
  const article05And12Summary = buildSummaryJson("job4", "script4", [], undefined, undefined, undefined, undefined, article05And12Notes);
  assert((article05And12Summary.notes?.article_05 ?? []).length === 1, "Article 05 must remain in summary.notes");
  assert((article05And12Summary.notes?.article_12 ?? []).length === 1, "Article 12 must remain in summary.notes");
  assert(article05And12Summary.notes_summary?.some((group) => group.category === "article_05"), "notes_summary must include article_05");
  assert(article05And12Summary.notes_summary?.some((group) => group.category === "article_12"), "notes_summary must include article_12");

  const article14Notes: DbNote[] = [
    buildNote({
      reviewer: "article_14_profanity_personal_insults",
      category: "article_14",
      title: "إهانة شخصية",
      description: "إهانة مباشرة لشخصية",
      snippet: "اقتباس الإهانة",
      event_id: 22,
      confidence: 0.95,
      status: "new",
      included_in_report: true,
    }),
  ];
  const article14Summary = buildSummaryJson("job3", "script3", [], undefined, undefined, undefined, undefined, article14Notes);
  assert((article14Summary.notes?.article_14 ?? []).length === 1, "Article 14 must remain in analysis_notes summary output");
  assert(article14Summary.canonical_findings?.length === 0, "Article 14 notes must not be promoted into canonical findings");
  assert(article14Summary.totals.findings_count === 0, "Article 14 notes must not increase violation totals");
  assert(article14Summary.findings_by_article.every((entry) => entry.article_id !== 14), "Article 14 notes must not appear in findings_by_article");
  assert(article14Summary.notes_summary?.some((group) => group.category === "article_14"), "Article 14 notes must remain in notes_summary");

  console.log("✓ Notes are grouped separately from violations, with Article 14 remaining a note-only category");
}

function testUnknownNoteCategoryRejected() {
  const notes: DbNote[] = [
    {
      reviewer: "note_entities_and_brand",
      category: "Unknown Category",
      title: "غير معروف",
      description: "وصف",
      snippet: "فقرة",
      event_id: 14,
      confidence: 0.8,
      status: "new",
      included_in_report: true,
    },
  ];
  const summary = buildSummaryJson("job1", "script1", [], undefined, undefined, undefined, undefined, notes);
  assert((summary.notes?.commercial_entities ?? []).length === 0, "Unknown category must not map to commercial_entities");
  assert((summary.notes_summary ?? []).length === 0, "Unknown category should be rejected from notes_summary");
  console.log("✓ Unknown note categories are rejected");
}

function testNotesRemainSeparateFromViolationTotals() {
  const findings: DbFinding[] = [
    { article_id: 15, atom_id: "15-1", severity: "high", confidence: 0.95, title_ar: "مخالفة", description_ar: "", evidence_snippet: "مخالفة", start_offset_global: 0, end_offset_global: 1, start_line_chunk: null, end_line_chunk: null, location: {} },
  ];
  const notes: DbNote[] = [
    buildNote({ reviewer: "article_05_violence_torture", category: "article_05", title: "ملاحظة", description: "ملاحظة ليست مخالفة", snippet: "ملاحظة", event_id: 5, confidence: 0.8 }),
  ];
  const summary = buildSummaryJson("job5", "script5", findings, undefined, undefined, undefined, undefined, notes);
  assert(summary.totals.findings_count === 1, "violations total should count only findings, not notes");
  assert((summary.notes?.article_05 ?? []).length === 1, "notes should remain grouped under notes");
  assert((summary.notes_summary ?? []).some((group) => group.category === "article_05"), "notes summary should include note categories");
  assert(summary.canonical_findings?.length === 1, "real violations should still appear as canonical findings");
  console.log("✓ notes remain separate from violation totals");
}

function testArticleNotesStayOutOfCanonicalViolationsWhenOnlyNotesExist() {
  const notes = Array.from({ length: 4 }, (_, index) => buildNote({
    reviewer: `article_14_note_${index}`,
    category: "article_14",
    title: `ملاحظة ${index + 1}`,
    description: "ملاحظة فقط",
    snippet: `اقتباس ${index + 1}`,
    event_id: 100 + index,
    confidence: 0.9,
    included_in_report: true,
  }));
  const summary = buildSummaryJson("job-note-only", "script-note-only", [], undefined, undefined, undefined, undefined, notes);
  assert(summary.totals.findings_count === 0, "zero violations plus notes should produce zero findings");
  assert(summary.canonical_findings?.length === 0, "notes must not be promoted to canonical findings");
  assert((summary.notes?.article_14 ?? []).length === 4, "all article 14 notes should remain in notes");
  assert((summary.notes_summary ?? []).some((group) => group.category === "article_14"), "article 14 note categories should remain in notes_summary");
  assert(summary.findings_by_article.every((entry) => entry.article_id !== 14), "article 14 notes must not enter findings_by_article");
  console.log("✓ article notes stay out of canonical violations when only notes are present");
}

function testArticleNotesStayOutOfCanonicalViolationsWhenMixedWithRealFindings() {
  const realFinding: DbFinding = {
    article_id: 15,
    atom_id: "15-1",
    severity: "high",
    confidence: 0.95,
    title_ar: "مخالفة حقيقية",
    description_ar: "",
    evidence_snippet: "مخالفة",
    start_offset_global: 0,
    end_offset_global: 1,
    start_line_chunk: null,
    end_line_chunk: null,
    location: {},
  };
  const notes = Array.from({ length: 4 }, (_, index) => buildNote({
    reviewer: `article_14_note_${index}`,
    category: "article_14",
    title: `ملاحظة ${index + 1}`,
    description: "ملاحظة فقط",
    snippet: `اقتباس ${index + 1}`,
    event_id: 200 + index,
    confidence: 0.9,
    included_in_report: true,
  }));
  const summary = buildSummaryJson("job-mixed", "script-mixed", [realFinding], undefined, undefined, undefined, undefined, notes);
  assert(summary.totals.findings_count === 1, "one real violation plus notes should yield one finding");
  assert((summary.canonical_findings ?? []).length === 1, "only real findings should appear in canonical_findings");
  assert((summary.notes?.article_14 ?? []).length === 4, "notes should remain separate from real findings");
  assert(summary.findings_by_article.every((entry) => entry.article_id !== 14), "article 14 notes must not appear in findings_by_article even when mixed with real findings");
  console.log("✓ article notes stay out of canonical violations when mixed with real findings");
}

function testArticleNoteCanonicalIdsAreBlockedFromReviewLayer() {
  assert(isArticleNoteCanonicalFindingId("article14-note-32ff4f9d-4e45-43c8-9a9a-0c6b5493c8d3"), "Article 14 note IDs must be recognized as note-originated");
  assert(isArticleNoteCanonicalFindingId("article05-note-abc123"), "Article 05 note IDs must be recognized as note-originated");
  assert(!isArticleNoteCanonicalFindingId("canonical-finding-123"), "Real violation IDs must remain valid for review-layer materialization");
  assert(!isArticleNoteCanonicalFindingId("article99-note-foo"), "Non-article note IDs should not be treated as Article Note IDs");
  console.log("✓ Article Note canonical IDs are identified separately from real violation IDs");
}

async function main() {
  testArticleOrder();
  testDedup();
  testDedupPrefersHigherConfidenceOnSameSeverity();
  testArticle26Excluded();
  testSummaryHasFindingsByArticle();
  testCrossArticleOverlapKeepsOwnershipSeparate();
  testNotesAreGroupedSeparately();
  testUnknownNoteCategoryRejected();
  testNotesRemainSeparateFromViolationTotals();
  testArticleNotesStayOutOfCanonicalViolationsWhenOnlyNotesExist();
  testArticleNotesStayOutOfCanonicalViolationsWhenMixedWithRealFindings();
  testArticleNoteCanonicalIdsAreBlockedFromReviewLayer();
  console.log("\nAll aggregation tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
