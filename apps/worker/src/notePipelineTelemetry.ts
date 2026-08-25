import { logger } from "./logger.js";

export const NOTE_CATEGORY_ORDER = [
  "article_01",
  "article_02",
  "article_03",
  "article_04",
  "article_05",
  "article_12",
  "article_06",
  "article_07",
  "article_08",
  "article_09",
  "article_10",
  "article_11",
  "article_13",
  "security_scenes",
  "saudi_names",
  "commercial_entities",
  "religious_content",
  "article_14",
  "article_15",
  "article_16",
  "article_17",
  "article_18",
  "article_19",
  "article_20",
  "article_21",
  "article_22",
  "article_23",
  "article_24",
] as const;

export type NoteCategoryKey = typeof NOTE_CATEGORY_ORDER[number];

const NOTE_CATEGORY_LABELS: Record<NoteCategoryKey, string> = {
  article_01: "Article01",
  article_02: "Article02",
  article_03: "Article03",
  article_04: "Article04",
  article_11: "Article11",
  article_13: "Article13",
  security_scenes: "Security",
  saudi_names: "SaudiNames",
  commercial_entities: "Entities",
  religious_content: "Religious",
  article_05: "Article05",
  article_12: "Article12",
  article_14: "Article14",
  article_15: "Article15",
  article_16: "Article16",
  article_17: "Article17",
  article_18: "Article18",
  article_19: "Article19",
  article_20: "Article20",
  article_21: "Article21",
  article_22: "Article22",
  article_23: "Article23",
  article_24: "Article24",
};

const NOTE_CATEGORY_RENDERED_TABS: Record<NoteCategoryKey, string> = {
  article_01: "Article 01",
  article_02: "Article 02",
  article_03: "Article 03",
  article_04: "Article 04",
  article_11: "Article 11",
  article_13: "Article 13",
  security_scenes: "Security Scenes",
  saudi_names: "Saudi Names",
  commercial_entities: "Commercial Entities",
  religious_content: "محتوى ديني / مذهبي حساس",
  article_05: "Article 05",
  article_12: "Article 12",
  article_14: "Article 14",
  article_15: "Article 15",
  article_16: "Article 16",
  article_17: "Article 17",
  article_18: "Article 18",
  article_19: "Article 19",
  article_20: "Article 20",
  article_21: "Article 21",
  article_22: "Article 22",
  article_23: "Article 23",
  article_24: "Article 24",
};

const NOTE_CATEGORY_ALIASES: Record<string, NoteCategoryKey> = {
  article_01: "article_01",
  article_02: "article_02",
  article_03: "article_03",
  article_04: "article_04",
  article_11: "article_11",
  article_13: "article_13",
  security_scenes: "security_scenes",
  "Security Scenes": "security_scenes",
  saudi_names: "saudi_names",
  "Saudi Names": "saudi_names",
  commercial_entities: "commercial_entities",
  "Commercial Entities": "commercial_entities",
  medical_notes: "article_13",
  "Medical Notes": "article_13",
  media_credibility: "article_11",
  "Media Credibility": "article_11",
  classified_documents: "article_21",
  "Classified Documents": "article_21",
  religious_content: "religious_content",
  "محتوى ديني / مذهبي حساس": "religious_content",
  article_05: "article_05",
  "Article 05": "article_05",
  article_06: "article_06",
  article_07: "article_07",
  article_08: "article_08",
  article_09: "article_09",
  article_10: "article_10",
  article_12: "article_12",
  "Article 12": "article_12",
  article_14: "article_14",
  "Article 14": "article_14",
  article_15: "article_15",
  article_16: "article_16",
  article_17: "article_17",
  article_18: "article_18",
  article_19: "article_19",
  article_20: "article_20",
  article_21: "article_21",
  article_22: "article_22",
  article_23: "article_23",
  article_24: "article_24",
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
