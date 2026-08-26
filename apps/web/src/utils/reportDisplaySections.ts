export interface ReportDisplaySectionCollections<T> {
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

export function buildReportDisplaySections<T>(sections: ReportDisplaySectionCollections<T>): ReportDisplaySectionCollections<T> {
  return {
    violations: [...(sections.violations ?? [])],
    notes: [...(sections.notes ?? [])],
    manual: [...(sections.manual ?? [])],
    glossary: [...(sections.glossary ?? [])],
  };
}

export function getReportDisplaySectionCounts<T>(sections: ReportDisplaySectionCollections<T>): ReportDisplaySectionCounts {
  const violations = sections.violations?.length ?? 0;
  const notes = sections.notes?.length ?? 0;
  const manual = sections.manual?.length ?? 0;
  const glossary = sections.glossary?.length ?? 0;
  return {
    all: violations + notes + manual + glossary,
    violations,
    notes,
    manual,
    glossary,
  };
}
