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

export function getCanonicalReportTotals(
  summary?: ReportSummaryLike | null,
  fallback?: { fallbackFindingsCount?: number | null; fallbackTypeCounts?: { ai?: number | null; manual?: number | null; glossary?: number | null; special?: number | null } | null },
  options?: CanonicalReportTotalsOptions
): CanonicalReportTotals {
  const totals = summary?.totals;
  const notesCount = typeof options?.notesCount === 'number'
    ? options.notesCount
    : countNotesInSummary(summary?.notes);
  const fallbackFindingsCount = Number(fallback?.fallbackFindingsCount ?? 0) || 0;
  const fallbackTypeCounts = fallback?.fallbackTypeCounts ?? {};
  const summaryCanonicalFindingCount = Array.isArray(summary?.canonical_findings) ? summary.canonical_findings.length : undefined;
  const explicitViolationCount = typeof options?.canonicalFindingCount === 'number'
    ? options.canonicalFindingCount
    : typeof summary?.context_metrics?.violation_count === 'number'
      ? summary.context_metrics.violation_count
      : typeof summaryCanonicalFindingCount === 'number'
        ? summaryCanonicalFindingCount
        : Number(totals?.findings_count ?? fallbackFindingsCount) || 0;
  const findingsCount = Number(explicitViolationCount) || 0;
  const typeCounts = totals?.type_counts ?? {};
  return {
    all: findingsCount + notesCount,
    violations: findingsCount,
    notes: notesCount,
    ai: Number(typeCounts.ai ?? fallbackTypeCounts.ai ?? 0) || 0,
    manual: typeof options?.manualCount === 'number' ? options.manualCount : Number(typeCounts.manual ?? fallbackTypeCounts.manual ?? 0) || 0,
    glossary: typeof options?.glossaryCount === 'number' ? options.glossaryCount : Number(typeCounts.glossary ?? fallbackTypeCounts.glossary ?? 0) || 0,
    special: typeof options?.specialCount === 'number' ? options.specialCount : Number(typeCounts.special ?? fallbackTypeCounts.special ?? 0) || 0,
  };
}
