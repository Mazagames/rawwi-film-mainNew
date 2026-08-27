import assert from "node:assert/strict";
import { buildPdfReportCollections } from "./pdfModel";

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
