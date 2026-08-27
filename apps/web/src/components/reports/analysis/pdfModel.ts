import type { AnalysisFinding, AnalysisReviewFinding } from "@/api";
import type { NoteCategoryKey, ReportNote } from "@/api/models";
import { getPolicyArticle } from "@/data/policyMap";
import { getNoteCategoryLabel, NOTE_CATEGORY_ORDER } from "@/utils/noteCategoryLabels";
import { dedupeReportDisplayItems } from "@/utils/reportDisplayDedupe";

type CanonicalFinding = {
  canonical_finding_id: string;
  title_ar: string;
  description_ar?: string | null;
  evidence_snippet: string;
  severity: string;
  confidence: number;
  rationale?: string | null;
  primary_article_id?: number | null;
  primary_policy_atom_id?: string | null;
  start_offset_global?: number | null;
  start_line_chunk?: number | null;
  end_line_chunk?: number | null;
  page_number?: number | null;
  source?: string | null;
};

export type PdfReportCard = {
  id: string;
  title: string;
  classification: "violation" | "note" | "manual" | "glossary";
  reference: string | null;
  pageNumber: number | null;
  position: number | null;
  evidence: string;
  description: string | null;
  confidence: number | null;
  originalIndex: number;
};

export type PdfReportCollections = {
  violations: PdfReportCard[];
  notes: PdfReportCard[];
  manual: PdfReportCard[];
  glossary: PdfReportCard[];
  totals: {
    all: number;
    violations: number;
    notes: number;
    manual: number;
    glossary: number;
  };
};

export type BuildPdfReportCollectionsParams = {
  findings?: AnalysisFinding[] | null;
  reviewFindings?: AnalysisReviewFinding[] | null;
  canonicalFindings?: CanonicalFinding[] | null;
  reportHints?: Array<{ canonical_finding_id?: string | null }> | null;
  findingsByArticle?: Array<{ article_id: number; top_findings?: Array<{ title_ar?: string; severity?: string; confidence?: number; evidence_snippet?: string }> }> | null;
  notes?: Partial<Record<NoteCategoryKey, ReportNote[]>> | null;
  lang: "ar" | "en";
};

function sourceClassification(source: string | null | undefined): "violation" | "manual" | "glossary" {
  if (source === "manual") return "manual";
  if (source === "lexicon_mandatory" || source === "glossary") return "glossary";
  return "violation";
}

function cardOrder(left: PdfReportCard, right: PdfReportCard): number {
  const leftPage = left.pageNumber ?? Number.MAX_SAFE_INTEGER;
  const rightPage = right.pageNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftPage !== rightPage) return leftPage - rightPage;
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  if (left.originalIndex !== right.originalIndex) return left.originalIndex - right.originalIndex;
  return left.id.localeCompare(right.id);
}

function articleReference(articleId: number | null | undefined, lang: "ar" | "en"): string | null {
  if (!Number.isFinite(articleId) || !articleId || articleId < 1) return null;
  const reportCategory = `article_${String(articleId).padStart(2, "0")}`;
  const reportLabel = getNoteCategoryLabel(reportCategory, lang);
  if (reportLabel && reportLabel !== reportCategory) return reportLabel;
  const article = getPolicyArticle(articleId);
  if (lang === "ar") return article?.title_ar ?? `المادة ${articleId}`;
  return `Article ${articleId}`;
}

function buildFindingCards(params: BuildPdfReportCollectionsParams): PdfReportCard[] {
  const visibleReviewRows = (params.reviewFindings ?? []).filter((row) => !row.isHidden);
  const reviewRows = visibleReviewRows
    .filter((row) => row.includeInReport !== false && row.reviewStatus !== "approved" && row.sourceKind !== "special")
    .map((row, originalIndex) => ({
      id: row.canonicalFindingId?.trim() || row.id,
      title: row.titleAr || "—",
      classification: sourceClassification(row.sourceKind),
      reference: articleReference(row.primaryArticleId, params.lang),
      pageNumber: row.pageNumber ?? null,
      position: row.startOffsetGlobal ?? null,
      evidence: row.evidenceSnippet || "",
      description: row.rationaleAr || row.descriptionAr || row.manualComment || null,
      confidence: row.anchorConfidence ?? null,
      originalIndex,
    }));
  if (visibleReviewRows.length > 0) return reviewRows;

  const reportHintIds = new Set((params.reportHints ?? []).map((hint) => hint.canonical_finding_id).filter((id): id is string => Boolean(id)));
  const realRows = (params.findings ?? [])
    .filter((row) => {
      const v3 = (row.location?.v3 as Record<string, unknown> | undefined) ?? {};
      const canonicalId = typeof v3.canonical_finding_id === "string" ? v3.canonical_finding_id : null;
      return row.reviewStatus !== "approved" && (!canonicalId || !reportHintIds.has(canonicalId));
    })
    .map((row, originalIndex) => ({
      id: row.id,
      title: row.titleAr || "—",
      classification: sourceClassification(row.source),
      reference: articleReference(row.articleId, params.lang),
      pageNumber: row.pageNumber ?? null,
      position: row.startOffsetGlobal ?? null,
      evidence: row.evidenceSnippet || "",
      description: row.rationaleAr || row.descriptionAr || row.manualComment || null,
      confidence: row.confidence ?? null,
      originalIndex,
    }));
  if (realRows.length > 0) return realRows;

  const canonicalRows = (params.canonicalFindings ?? []).map((row, originalIndex) => ({
    id: row.canonical_finding_id || `canonical-${originalIndex}`,
    title: row.title_ar || "—",
    classification: sourceClassification(row.source),
    reference: articleReference(row.primary_article_id, params.lang),
    pageNumber: row.page_number ?? null,
    position: row.start_offset_global ?? null,
    evidence: row.evidence_snippet || "",
    description: row.rationale || row.description_ar || null,
    confidence: row.confidence ?? null,
    originalIndex,
  }));
  if (canonicalRows.length > 0) return canonicalRows;

  return (params.findingsByArticle ?? []).flatMap((article, articleIndex) =>
    (article.top_findings ?? []).map((row, findingIndex) => ({
      id: `summary-${article.article_id}-${findingIndex}`,
      title: row.title_ar || "—",
      classification: "violation" as const,
      reference: articleReference(article.article_id, params.lang),
      pageNumber: null,
      position: null,
      evidence: row.evidence_snippet || "",
      description: null,
      confidence: row.confidence ?? null,
      originalIndex: articleIndex * 10_000 + findingIndex,
    }))
  );
}

function buildNoteCards(params: BuildPdfReportCollectionsParams): PdfReportCard[] {
  const notesByCategory = params.notes ?? {};
  const cards: PdfReportCard[] = [];
  let originalIndex = 0;
  for (const category of NOTE_CATEGORY_ORDER) {
    const deduped = dedupeReportDisplayItems(
      notesByCategory[category.key] ?? [],
      () => "note",
      (note) => note.category,
      () => null,
      (note) => note.description,
    );
    for (const note of deduped) {
      if (note.included_in_report === false) continue;
      cards.push({
        id: note.id,
        title: note.title || "—",
        classification: "note",
        reference: getNoteCategoryLabel(note.category, params.lang) || note.category,
        pageNumber: null,
        position: note.event_id || null,
        evidence: note.snippet || "",
        description: note.description || note.reviewer_comment || note.comment || null,
        confidence: note.confidence ?? null,
        originalIndex: originalIndex++,
      });
    }
  }
  return cards;
}

export function buildPdfReportCollections(params: BuildPdfReportCollectionsParams): PdfReportCollections {
  const findingCards = buildFindingCards(params);
  const dedupedFindings = new Map<string, PdfReportCard>();
  for (const card of findingCards) {
    const key = `${card.classification}\u001f${card.id || `${card.reference}\u001f${card.evidence}`}`;
    if (!dedupedFindings.has(key)) dedupedFindings.set(key, card);
  }
  const notes = buildNoteCards(params);
  const dedupedNotes = new Map<string, PdfReportCard>();
  for (const card of notes) {
    if (!dedupedNotes.has(card.id)) dedupedNotes.set(card.id, card);
  }
  const classified = Array.from(dedupedFindings.values()).reduce(
    (sections, card) => {
      if (card.classification === "violation") sections.violations.push(card);
      else sections[card.classification].push(card);
      return sections;
    },
    { violations: [] as PdfReportCard[], notes: Array.from(dedupedNotes.values()), manual: [] as PdfReportCard[], glossary: [] as PdfReportCard[] }
  );
  const violations = classified.violations.sort(cardOrder);
  const manual = classified.manual.sort(cardOrder);
  const glossary = classified.glossary.sort(cardOrder);
  const sortedNotes = classified.notes.sort(cardOrder);
  const totals = {
    violations: violations.length,
    notes: sortedNotes.length,
    manual: manual.length,
    glossary: glossary.length,
    all: violations.length + sortedNotes.length + manual.length + glossary.length,
  };
  return { violations, notes: sortedNotes, manual, glossary, totals };
}