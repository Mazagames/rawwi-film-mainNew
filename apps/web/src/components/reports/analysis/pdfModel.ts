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

function sourceClassification(row: { source?: string | null; sourceKind?: string | null; severity?: string | null; category?: string | null }): "violation" | "note" | "manual" | "glossary" {
  const src = row.sourceKind || row.source;
  if (src === "manual") return "manual";
  if (src === "lexicon_mandatory" || src === "glossary") return "glossary";
  const sev = row.severity?.toLowerCase();
  if (
    sev === "note" ||
    sev === "ملاحظة" ||
    row.category === "ملاحظة" ||
    src === "informational" ||
    src === "special"
  ) {
    return "note";
  }
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

/**
 * Classification for a note record based on its category key.
 *
 * The web Analysis Report uses two semantic buckets from `notesState`:
 *   - `article_*` categories  → Violations tab  (`bannerViolationsCount`)
 *   - non-article categories  → Notes tab        (`bannerNotesCount`)
 *
 * The PDF must mirror this exact split so that PDF statistics match
 * the web banner without relying on `severity`/`source` fields that
 * are absent from the `ReportNote` model.
 */
function noteCategoryClassification(category: string, isQuickAnalysis?: boolean): "violation" | "note" {
  if (isQuickAnalysis) return "note";
  return category.startsWith("article_") ? "violation" : "note";
}

/**
 * Build a deduplicated list of PdfReportCards from `params.notes`.
 * Each record's classification is determined by its category key:
 *   - article_* → violation
 *   - everything else → note
 *
 * Records with `included_in_report === false` are excluded.
 */
function buildNoteBasedCards(params: BuildPdfReportCollectionsParams): PdfReportCard[] {
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
      const cls = noteCategoryClassification(category.key, params.isQuickAnalysis);
      cards.push({
        id: note?.id || `note-${originalIndex}`,
        title: note.title || "-",
        classification: cls,
        reference: getNoteCategoryLabel(category.key, params.lang) || category.key,
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

/**
 * Build PdfReportCards from raw findings arrays (findings / reviewFindings /
 * canonicalFindings / findingsByArticle).
 *
 * Used as a fallback when `params.notes` is empty — i.e., for reports where
 * the findings come directly through the findings arrays and NOT through the
 * notes-payload path (e.g. older report formats or direct AI findings).
 *
 * NOTE: A review finding only overrides the canonical item that it explicitly
 * references via `canonicalFindingId`.  A single review item MUST NOT suppress
 * the entire canonical collection.
 */
function buildFindingBasedCards(params: BuildPdfReportCollectionsParams): PdfReportCard[] {
  const visibleReviewRows = (params.reviewFindings ?? []).filter((row) => !row.isHidden);

  // Build a set of canonical IDs that have been overridden by a review finding.
  const overriddenIds = new Set<string>();
  visibleReviewRows.forEach(row => {
    if (row.canonicalFindingId) overriddenIds.add(row.canonicalFindingId);
  });

  const reviewRows = visibleReviewRows
    .filter((row) => row.includeInReport !== false && row.reviewStatus !== "approved" && row.sourceKind !== "special")
    .map((row, originalIndex) => ({
      id: row?.canonicalFindingId?.trim() || row?.id || `review-${originalIndex}`,
      title: row.titleAr || "-",
      classification: sourceClassification(row),
      reference: articleReference(row.primaryArticleId, params.lang),
      pageNumber: row.pageNumber ?? null,
      position: row.startOffsetGlobal ?? null,
      evidence: row.evidenceSnippet || "",
      description: row.rationaleAr || row.descriptionAr || row.manualComment || null,
      confidence: row.anchorConfidence ?? null,
      originalIndex,
    }));

  const reportHintIds = new Set((params.reportHints ?? []).map((hint) => hint.canonical_finding_id).filter((id): id is string => Boolean(id)));

  const realRows = (params.findings ?? [])
    .filter((row) => {
      const v3 = (row.location?.v3 as Record<string, unknown> | undefined) ?? {};
      const canonicalId = typeof v3.canonical_finding_id === "string" ? v3.canonical_finding_id : null;
      return row.reviewStatus !== "approved" && (!canonicalId || !reportHintIds.has(canonicalId)) && (!canonicalId || !overriddenIds.has(canonicalId));
    })
    .map((row, originalIndex) => ({
      id: row?.id || `real-${originalIndex}`,
      title: row.titleAr || "-",
      classification: sourceClassification(row),
      reference: articleReference(row.articleId, params.lang),
      pageNumber: row.pageNumber ?? null,
      position: row.startOffsetGlobal ?? null,
      evidence: row.evidenceSnippet || "",
      description: row.rationaleAr || row.descriptionAr || row.manualComment || null,
      confidence: row.confidence ?? null,
      originalIndex,
    }));

  const canonicalRows = (params.canonicalFindings ?? [])
    .filter((row) => {
      const id = row.canonical_finding_id;
      return !id || !overriddenIds.has(id);
    })
    .map((row, originalIndex) => ({
      id: row?.canonical_finding_id || `canonical-${originalIndex}`,
      title: row.title_ar || "-",
      classification: sourceClassification(row),
      reference: articleReference(row.primary_article_id, params.lang),
      pageNumber: row.page_number ?? null,
      position: row.start_offset_global ?? null,
      evidence: row.evidence_snippet || "",
      description: row.rationale || row.description_ar || null,
      confidence: row.confidence ?? null,
      originalIndex,
    }));

  const summaryRows = (params.findingsByArticle ?? [])
    .flatMap((article, articleIndex) =>
      (article.top_findings ?? []).map((row, findingIndex) => ({
        id: `summary-${article.article_id}-${findingIndex}`,
        title: row.title_ar || "-",
        classification: sourceClassification(row),
        reference: articleReference(article.article_id, params.lang),
        pageNumber: null,
        position: null,
        evidence: row.evidence_snippet || "",
        description: null,
        confidence: row.confidence ?? null,
        originalIndex: articleIndex * 10_000 + findingIndex,
      }))
    )
    .filter((row) => !overriddenIds.has(row.id));

  const merged = [...reviewRows, ...realRows, ...canonicalRows];
  if (merged.length > 0) return merged;
  return summaryRows;
}

/**
 * Determine if the `findings` (raw AI findings) array has usable content.
 * When true, `params.findings` is the authoritative source for violations.
 * When false, we use `params.notes[article_*]` for violations — which is
 * the correct source for Quick Analysis and modern reports.
 *
 * IMPORTANT: `reviewFindings` are deliberately NOT checked here.
 * Review findings (including violation-type) are always merged on top
 * via the review-override step below, regardless of which path is chosen.
 * Including them in this check would wrongly force the FINDINGS PATH when
 * only glossary/manual/violation review items exist but params.findings is
 * empty — causing all 65 article-note violations to be discarded.
 *
 * `canonicalFindings` is also excluded — it is already represented in
 * `params.notes` for modern reports and only used as a last-resort fallback
 * inside `buildFindingBasedCards`.
 */
function hasFindingsPayload(params: BuildPdfReportCollectionsParams): boolean {
  return (params.findings ?? []).length > 0;
}

export function buildPdfReportCollections(params: BuildPdfReportCollectionsParams): PdfReportCollections {
  const allCards = new Map<string, PdfReportCard>();

  if (hasFindingsPayload(params)) {
    // FINDINGS PATH: violations, glossary, manual come from findings arrays.
    // Notes always come from params.notes (non-article categories only).
    const findingCards = buildFindingBasedCards(params);
    for (const card of findingCards) {
      const key = card.id || `${card.reference}\u001f${card.evidence}`;
      if (!allCards.has(key)) allCards.set(key, card);
    }
    // Add notes from non-article note categories.
    const noteCards = buildNoteBasedCards(params).filter(c => c.classification === "note");
    for (const card of noteCards) {
      if (!allCards.has(card.id)) allCards.set(card.id, card);
    }
  } else {
    // NOTES PATH (Quick Analysis / modern reports): no raw findings.
    // The notes payload contains ALL report items keyed by semantic category:
    //   article_* categories → violations (matches web bannerViolationsCount)
    //   non-article categories → notes (matches web bannerNotesCount)
    // Review findings for glossary/manual are merged on top.
    const noteCards = buildNoteBasedCards(params);
    for (const card of noteCards) {
      const key = card.id || `${card.reference}\u001f${card.evidence}`;
      if (!allCards.has(key)) allCards.set(key, card);
    }
  }

  // Always merge review glossary/manual override cards on top of either path.
  const seenIds = new Set(allCards.keys());
  const visibleReviewRows = (params.reviewFindings ?? []).filter((row) => !row.isHidden);
  visibleReviewRows
    .filter((row) => row.includeInReport !== false && row.reviewStatus !== "approved")
    .forEach((row, originalIndex) => {
      const cls = sourceClassification(row);
      if (cls === "note") return; // Notes are already handled by note pipeline (except special which are excluded above)
      const id = row.canonicalFindingId?.trim() || row.id;
      if (seenIds.has(id)) return;
      seenIds.add(id);
      allCards.set(id, {
        id,
        title: row.titleAr || "-",
        classification: cls,
        reference: articleReference(row.primaryArticleId, params.lang),
        pageNumber: row.pageNumber ?? null,
        position: row.startOffsetGlobal ?? null,
        evidence: row.evidenceSnippet || "",
        description: row.rationaleAr || row.descriptionAr || row.manualComment || null,
        confidence: row.anchorConfidence ?? null,
        originalIndex,
      });
    });

  // Classify into four mutually exclusive buckets.
  const violations: PdfReportCard[] = [];
  const notes: PdfReportCard[] = [];
  const manual: PdfReportCard[] = [];
  const glossary: PdfReportCard[] = [];

  for (const card of allCards.values()) {
    if (card.classification === "violation") violations.push(card);
    else if (card.classification === "note") notes.push(card);
    else if (card.classification === "manual") manual.push(card);
    else if (card.classification === "glossary") glossary.push(card);
  }

  violations.sort(cardOrder);
  notes.sort(cardOrder);
  manual.sort(cardOrder);
  glossary.sort(cardOrder);

  const totals = {
    violations: violations.length,
    notes: notes.length,
    manual: manual.length,
    glossary: glossary.length,
    all: violations.length + notes.length + manual.length + glossary.length,
  };

  return { violations, notes, manual, glossary, totals };
}