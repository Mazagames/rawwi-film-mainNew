export type ReportDisplayFamily = 'violation' | 'note' | 'manual' | 'glossary';

type Resolver<T, V> = (item: T) => V;

function normalizeDisplayPart(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function dedupeReportDisplayItems<T>(
  items: readonly T[],
  family: Resolver<T, ReportDisplayFamily>,
  categoryResolver: Resolver<T, unknown>,
  pageResolver: Resolver<T, unknown>,
  descriptionResolver: Resolver<T, unknown>,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const resolvedFamily = family(item);
    const category = normalizeDisplayPart(categoryResolver(item)).toLowerCase();
    const pageValue = pageResolver(item);
    const page = pageValue == null ? 'null' : normalizeDisplayPart(pageValue);
    const description = normalizeDisplayPart(descriptionResolver(item));
    if (!description) {
      result.push(item);
      continue;
    }
    const key = `${resolvedFamily}\u001f${category}\u001f${page}\u001f${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}
