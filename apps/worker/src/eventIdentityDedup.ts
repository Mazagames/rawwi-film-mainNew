export type EventIdentityFindingLike = {
  article_id: number;
  event_id?: number | null;
  evidence_snippet?: string | null;
  severity?: string | null;
  confidence?: number | null;
  canonical_atom?: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function evidenceSignature(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : "";
}

function severityRank(value: string | null | undefined): number {
  switch ((value ?? "medium").toLowerCase()) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 2;
  }
}

function isSameIncident(candidate: EventIdentityFindingLike, existing: EventIdentityFindingLike): boolean {
  const sameEvent = Boolean(candidate.event_id && existing.event_id && candidate.event_id === existing.event_id);
  if (!sameEvent) return false;

  const sameArticle = candidate.article_id === existing.article_id;
  if (!sameArticle) return false;

  return true;
}

export function dedupeFindingsByEventIdentity<T extends EventIdentityFindingLike>(findings: T[]): T[] {
  const kept: T[] = [];

  for (const finding of findings) {
    let duplicateOf: T | null = null;

    for (const existing of kept) {
      if (!isSameIncident(finding, existing)) continue;
      const shouldReplace =
        severityRank(finding.severity) > severityRank(existing.severity) ||
        (severityRank(finding.severity) === severityRank(existing.severity) && (finding.confidence ?? 0) > (existing.confidence ?? 0));
      if (shouldReplace) {
        duplicateOf = existing;
        break;
      }
    }

    if (duplicateOf) {
      const index = kept.indexOf(duplicateOf);
      if (index >= 0) kept[index] = finding;
      continue;
    }

    kept.push(finding);
  }

  return kept;
}
