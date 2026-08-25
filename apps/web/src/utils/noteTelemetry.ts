import type { NoteCategoryKey, ReportNote } from "@/api/models";

const NOTE_CATEGORY_LABELS: Record<NoteCategoryKey, string> = {
  ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`article_${String(index + 1).padStart(2, "0")}`, `Article${String(index + 1).padStart(2, "0")}`])),
  security_scenes: "Security",
  saudi_names: "SaudiNames",
  commercial_entities: "Entities",
  medical_notes: "Medical",
  media_credibility: "Media",
  classified_documents: "Classified",
  religious_content: "Religious",
};

const NOTE_CATEGORY_ORDER: NoteCategoryKey[] = [
  ...(Array.from({ length: 24 }, (_, index) => `article_${String(index + 1).padStart(2, "0")}`) as NoteCategoryKey[]),
  "security_scenes",
  "saudi_names",
  "commercial_entities",
  "medical_notes",
  "media_credibility",
  "classified_documents",
  "religious_content",
];

type NoteCounts = Record<NoteCategoryKey, number>;

export function countNotesByCategory(notes: Partial<Record<NoteCategoryKey, ReportNote[]>> | null | undefined): NoteCounts {
  const counts = Object.fromEntries(NOTE_CATEGORY_ORDER.map((category) => [category, 0])) as NoteCounts;
  if (!notes) return counts;
  for (const category of NOTE_CATEGORY_ORDER) {
    const list = notes[category];
    counts[category] = Array.isArray(list) ? list.length : 0;
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
    return `  ${NOTE_CATEGORY_LABELS[category]} ${actionLabel}: ${count}`;
  }).filter((line): line is string => Boolean(line));
}

export function logNotePipelineStage(args: {
  stageLabel: string;
  actionLabel: "Rendered";
  noteCounts: NoteCounts;
  reportId?: string | null;
  jobId?: string | null;
  source?: string;
}): void {
  const total = sumCounts(args.noteCounts);
  const lines = [
    "===== NOTE PIPELINE =====",
    `${args.stageLabel}:`,
    ...formatCounts(args.noteCounts, args.actionLabel),
    `  Total: ${total}`,
    "===========================",
  ];
  console.info(lines.join("\n"), {
    reportId: args.reportId ?? null,
    jobId: args.jobId ?? null,
    stage: args.stageLabel,
    action: args.actionLabel,
    total,
    noteCounts: args.noteCounts,
    source: args.source ?? "web",
  });
}
