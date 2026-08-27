export interface ReportDisplaySectionCollections<T = unknown> {
  violations: T[];
  notes: T[];
  manual: T[];
  glossary: T[];
}

export interface ReportDisplaySectionCounts {
  all: number;
  violations: number;
  notes: number;
  manual: number;
  glossary: number;
}

export function buildReportDisplaySections<T = unknown>(sections: ReportDisplaySectionCollections<T>): ReportDisplaySectionCollections<T> {
  return {
    violations: [...(sections.violations ?? [])],
    notes: [...(sections.notes ?? [])],
    manual: [...(sections.manual ?? [])],
    glossary: [...(sections.glossary ?? [])],
  };
}

function getItemIdentity<T>(item: T): string {
  if (item && typeof item === 'object') {
    const maybeId = (item as Record<string, unknown>).id;
    if (typeof maybeId === 'string' || typeof maybeId === 'number') {
      return String(maybeId);
    }
  }
  return JSON.stringify(item);
}

export function getReportDisplaySectionCounts<T = unknown>(sections: ReportDisplaySectionCollections<T>): ReportDisplaySectionCounts {
  const violations = sections.violations?.length ?? 0;
  const notes = sections.notes?.length ?? 0;
  const manual = sections.manual?.length ?? 0;
  const glossary = sections.glossary?.length ?? 0;
  const uniqueAllItems = new Set<string>();
  for (const item of [
    ...(sections.violations ?? []),
    ...(sections.notes ?? []),
    ...(sections.manual ?? []),
    ...(sections.glossary ?? []),
  ]) {
    uniqueAllItems.add(getItemIdentity(item));
  }
  return {
    all: uniqueAllItems.size,
    violations,
    notes,
    manual,
    glossary,
  };
}
