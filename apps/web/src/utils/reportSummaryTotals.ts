export interface CanonicalReportTotals {
  all: number;
  violations: number;
  notes: number;
  ai: number;
  manual: number;
  glossary: number;
  special: number;
}

export interface ReportSummaryLike {
  totals?: {
    findings_count?: number | null;
    type_counts?: {
      ai?: number | null;
      manual?: number | null;
      glossary?: number | null;
      special?: number | null;
    } | null;
  } | null;
  context_metrics?: {
    violation_count?: number | null;
  } | null;
  canonical_findings?: Array<Record<string, unknown>> | null;
  notes?: Record<string, unknown[] | null | undefined> | null;
}

export interface CanonicalReportTotalsOptions {
  canonicalFindingCount?: number | null;
  notesCount?: number | null;
  manualCount?: number | null;
  glossaryCount?: number | null;
  specialCount?: number | null;
}

export function countNotesInSummary(notes?: ReportSummaryLike['notes']): number {
  if (!notes || typeof notes !== 'object') return 0;
  return Object.values(notes).reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0);
}

/**
 * Count only non-article note categories (informational notes).
 * Mirrors the web Analysis Report's `bannerNotesCount = informationalNotesAllCount`.
 * Keys starting with `article_` are violations, not notes.
 */
export function countInformationalNotesInSummary(notes?: ReportSummaryLike['notes']): number {
  if (!notes || typeof notes !== 'object') return 0;
  return Object.entries(notes).reduce(
    (sum, [key, group]) => sum + (!key.startsWith('article_') && Array.isArray(group) ? group.length : 0),
    0,
  );
}

/**
 * Count article-category note items (which are violations in the web UI).
 * Mirrors the web Analysis Report's `bannerViolationsCount = articleNotesAllCount`.
 */
export function countArticleNotesInSummary(notes?: ReportSummaryLike['notes']): number {
  if (!notes || typeof notes !== 'object') return 0;
  return Object.entries(notes).reduce(
    (sum, [key, group]) => sum + (key.startsWith('article_') && Array.isArray(group) ? group.length : 0),
    0,
  );
}

export function getCanonicalReportTotals(
  summary?: ReportSummaryLike | null,
  fallback?: { fallbackFindingsCount?: number | null; fallbackTypeCounts?: { ai?: number | null; manual?: number | null; glossary?: number | null; special?: number | null } | null },
  options?: CanonicalReportTotalsOptions
): CanonicalReportTotals {
  const totals = summary?.totals;
  const fallbackFindingsCount = Number(fallback?.fallbackFindingsCount ?? 0) || 0;
  const fallbackTypeCounts = fallback?.fallbackTypeCounts ?? {};
  const typeCounts = totals?.type_counts ?? {};

  // --- Violations ---
  // Prefer the article_* split from notes (matches web bannerViolationsCount).
  // Fall back to canonical_findings count, then context_metrics, then summary totals.
  const articleNotesCount = countArticleNotesInSummary(summary?.notes);
  const summaryCanonicalFindingCount = Array.isArray(summary?.canonical_findings)
    ? summary.canonical_findings.length
    : undefined;
  let violationsCount: number;
  if (typeof options?.canonicalFindingCount === 'number') {
    violationsCount = options.canonicalFindingCount;
  } else if (articleNotesCount > 0) {
    // Modern reports: violations are stored as article_* note categories.
    // This matches the web Analysis Report's bannerViolationsCount.
    violationsCount = articleNotesCount;
  } else if (typeof summary?.context_metrics?.violation_count === 'number' && summary.context_metrics.violation_count > 0) {
    violationsCount = summary.context_metrics.violation_count;
  } else if (typeof summaryCanonicalFindingCount === 'number') {
    violationsCount = summaryCanonicalFindingCount;
  } else {
    violationsCount = Number(totals?.findings_count ?? fallbackFindingsCount) || 0;
  }

  // --- Notes ---
  // Prefer informational (non-article) note categories (matches web bannerNotesCount).
  // Fall back to options override, then total note count.
  const notesCount = typeof options?.notesCount === 'number'
    ? options.notesCount
    : summary?.notes
      ? countInformationalNotesInSummary(summary.notes)
      : 0;

  return {
    all: violationsCount + notesCount,
    violations: violationsCount,
    notes: notesCount,
    ai: Number(typeCounts.ai ?? fallbackTypeCounts.ai ?? 0) || 0,
    manual: typeof options?.manualCount === 'number' ? options.manualCount : Number(typeCounts.manual ?? fallbackTypeCounts.manual ?? 0) || 0,
    glossary: typeof options?.glossaryCount === 'number' ? options.glossaryCount : Number(typeCounts.glossary ?? fallbackTypeCounts.glossary ?? 0) || 0,
    special: typeof options?.specialCount === 'number' ? options.specialCount : Number(typeCounts.special ?? fallbackTypeCounts.special ?? 0) || 0,
  };
}
