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
  notes?: Record<string, unknown[] | null | undefined> | null;
}

export function countNotesInSummary(notes?: ReportSummaryLike['notes']): number {
  if (!notes || typeof notes !== 'object') return 0;
  return Object.values(notes).reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0);
}

export function getCanonicalReportTotals(
  summary?: ReportSummaryLike | null,
  fallback?: { fallbackFindingsCount?: number | null; fallbackTypeCounts?: { ai?: number | null; manual?: number | null; glossary?: number | null; special?: number | null } | null }
): CanonicalReportTotals {
  const totals = summary?.totals;
  const notesCount = countNotesInSummary(summary?.notes);
  const fallbackFindingsCount = Number(fallback?.fallbackFindingsCount ?? 0) || 0;
  const fallbackTypeCounts = fallback?.fallbackTypeCounts ?? {};
  const findingsCount = Number(totals?.findings_count ?? fallbackFindingsCount) || 0;
  const typeCounts = totals?.type_counts ?? {};
  return {
    all: findingsCount + notesCount,
    violations: findingsCount,
    notes: notesCount,
    ai: Number(typeCounts.ai ?? fallbackTypeCounts.ai ?? 0) || 0,
    manual: Number(typeCounts.manual ?? fallbackTypeCounts.manual ?? 0) || 0,
    glossary: Number(typeCounts.glossary ?? fallbackTypeCounts.glossary ?? 0) || 0,
    special: Number(typeCounts.special ?? fallbackTypeCounts.special ?? 0) || 0,
  };
}
