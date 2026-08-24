import { logger } from "./logger.js";

export const NOTE_CATEGORY_ORDER = [
  "security_scenes",
  "saudi_names",
  "commercial_entities",
  "medical_notes",
  "media_credibility",
  "classified_documents",
  "religious_content",
  "article_14",
] as const;

export type NoteCategoryKey = typeof NOTE_CATEGORY_ORDER[number];

const NOTE_CATEGORY_LABELS: Record<NoteCategoryKey, string> = {
  security_scenes: "Security",
  saudi_names: "SaudiNames",
  commercial_entities: "Entities",
  medical_notes: "Medical",
  media_credibility: "Media",
  classified_documents: "Classified",
  religious_content: "Religious",
  article_14: "Article14",
};

const NOTE_CATEGORY_RENDERED_TABS: Record<NoteCategoryKey, string> = {
  security_scenes: "Security Scenes",
  saudi_names: "Saudi Names",
  commercial_entities: "Commercial Entities",
  medical_notes: "Medical Notes",
  media_credibility: "Media Credibility",
  classified_documents: "Classified Documents",
  religious_content: "محتوى ديني / مذهبي حساس",
  article_14: "Article 14",
};

const NOTE_CATEGORY_ALIASES: Record<string, NoteCategoryKey> = {
  security_scenes: "security_scenes",
  "Security Scenes": "security_scenes",
  saudi_names: "saudi_names",
  "Saudi Names": "saudi_names",
  commercial_entities: "commercial_entities",
  "Commercial Entities": "commercial_entities",
  medical_notes: "medical_notes",
  "Medical Notes": "medical_notes",
  media_credibility: "media_credibility",
  "Media Credibility": "media_credibility",
  classified_documents: "classified_documents",
  "Classified Documents": "classified_documents",
  religious_content: "religious_content",
  "محتوى ديني / مذهبي حساس": "religious_content",
  article_14: "article_14",
  "Article 14": "article_14",
};

type NoteCounts = Record<string, number>;

export function normalizeNoteCategoryKey(category: string | null | undefined): NoteCategoryKey | null {
  const normalized = String(category ?? "").trim();
  if (!normalized) return null;
  return NOTE_CATEGORY_ALIASES[normalized] ?? null;
}

export function getRenderedNoteTabLabel(category: string | null | undefined): string | null {
  const key = normalizeNoteCategoryKey(category);
  return key ? NOTE_CATEGORY_RENDERED_TABS[key] : null;
}

export function countNoteCategoriesFromArray(notes: Array<{ category?: string | null }>): NoteCounts {
  const counts: NoteCounts = {};
  for (const note of notes) {
    const key = normalizeNoteCategoryKey(note.category);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function countNoteCategoriesFromSummary(notes: Partial<Record<string, Array<unknown>>> | null | undefined): NoteCounts {
  const counts: NoteCounts = {};
  if (!notes) return counts;
  for (const [category, items] of Object.entries(notes)) {
    const key = normalizeNoteCategoryKey(category);
    if (!key || !Array.isArray(items) || items.length === 0) continue;
    counts[key] = items.length;
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

export function logNoteCategoryMapping(args: {
  reviewerName: string;
  persistedCategory: string;
  renderedTab: string | null;
  jobId?: string | null;
  chunkId?: string | null;
  eventId?: number | null;
  status?: "accepted" | "rejected";
  reason?: string | null;
}): void {
  const rejected = args.status === "rejected";
  const payload = {
    reviewer_name: args.reviewerName,
    persisted_category: args.persistedCategory,
    rendered_tab: args.renderedTab,
    jobId: args.jobId ?? null,
    chunkId: args.chunkId ?? null,
    event_id: args.eventId ?? null,
    status: args.status ?? "accepted",
    ...(args.reason ? { reason: args.reason } : {}),
  };
  if (rejected) {
    logger.warn("Note category mapping", payload);
    return;
  }
  logger.info("Note category mapping", payload);
}
