import { logger } from "./logger.js";

const NOTE_CATEGORY_LABELS: Record<string, string> = {
  security_scenes: "Security",
  saudi_names: "SaudiNames",
  commercial_entities: "Entities",
  medical_notes: "Medical",
  media_credibility: "Media",
  classified_documents: "Classified",
};

const NOTE_CATEGORY_ORDER = [
  "security_scenes",
  "saudi_names",
  "commercial_entities",
  "medical_notes",
  "media_credibility",
  "classified_documents",
] as const;

type NoteCounts = Record<string, number>;

export function countNoteCategoriesFromArray(notes: Array<{ category?: string | null }>): NoteCounts {
  const counts: NoteCounts = {};
  for (const note of notes) {
    const key = String(note.category ?? "").trim();
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function countNoteCategoriesFromSummary(notes: Partial<Record<string, Array<unknown>>> | null | undefined): NoteCounts {
  const counts: NoteCounts = {};
  if (!notes) return counts;
  for (const [category, items] of Object.entries(notes)) {
    if (!Array.isArray(items) || items.length === 0) continue;
    counts[category] = items.length;
  }
  return counts;
}

function sumCounts(noteCounts: NoteCounts): number {
  return Object.values(noteCounts).reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
}

function formatCounts(noteCounts: NoteCounts, actionLabel: string): string[] {
  return NOTE_CATEGORY_ORDER.map((category) => {
    const count = noteCounts[category] ?? 0;
    if (!count) return null;
    const label = NOTE_CATEGORY_LABELS[category] ?? category;
    return `  ${label} ${actionLabel}: ${count}`;
  }).filter((line): line is string => Boolean(line));
}

export function logNotePipelineStage(args: {
  jobId: string;
  stageLabel: string;
  actionLabel: "Generated" | "Persisted" | "Aggregated";
  noteCounts: NoteCounts;
  chunkId?: string | null;
  reportId?: string | null;
  extra?: Record<string, unknown>;
}): void {
  const lines = [
    "===== NOTE PIPELINE =====",
    `${args.stageLabel}:`,
    ...formatCounts(args.noteCounts, args.actionLabel),
    `  Total: ${sumCounts(args.noteCounts)}`,
    "===========================",
  ];
  logger.info(lines.join("\n"), {
    jobId: args.jobId,
    chunkId: args.chunkId ?? null,
    reportId: args.reportId ?? null,
    stage: args.stageLabel,
    action: args.actionLabel,
    total: sumCounts(args.noteCounts),
    noteCounts: args.noteCounts,
    ...args.extra,
  });
}
