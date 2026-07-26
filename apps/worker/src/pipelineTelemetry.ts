import { logger } from "./logger.js";

type ArticleCountMap = Map<number, number>;
type NoteCountMap = Map<string, number>;

type StageTelemetry = {
  inputTotal: number | null;
  outputTotal: number;
  articleCounts: ArticleCountMap;
};

type JobPipelineTelemetry = {
  stages: Record<string, StageTelemetry | undefined>;
  notesByCategory: NoteCountMap;
  emitted: boolean;
};

const JOB_TELEMETRY = new Map<string, JobPipelineTelemetry>();

const STAGE_ORDER = [
  "reviewer_output",
  "merge",
  "validator",
  "auditor",
  "persistence",
  "aggregation",
  "report",
] as const;

const NOTE_CATEGORY_LABELS: Record<string, string> = {
  security_scenes: "Security",
  saudi_names: "SaudiNames",
  commercial_entities: "Entities",
  medical_notes: "Medical",
  media_credibility: "Media",
  classified_documents: "Classified",
};

function getJobTelemetry(jobId: string): JobPipelineTelemetry {
  const existing = JOB_TELEMETRY.get(jobId);
  if (existing) return existing;
  const created: JobPipelineTelemetry = {
    stages: {},
    notesByCategory: new Map<string, number>(),
    emitted: false,
  };
  JOB_TELEMETRY.set(jobId, created);
  return created;
}

function ensureStage(job: JobPipelineTelemetry, stageName: string): StageTelemetry {
  const existing = job.stages[stageName];
  if (existing) return existing;
  const created: StageTelemetry = {
    inputTotal: null,
    outputTotal: 0,
    articleCounts: new Map<number, number>(),
  };
  job.stages[stageName] = created;
  return created;
}

function addCount(map: ArticleCountMap, articleId: number, count: number): void {
  if (!Number.isFinite(articleId) || articleId <= 0 || !Number.isFinite(count) || count <= 0) return;
  map.set(articleId, (map.get(articleId) ?? 0) + count);
}

function formatArticleCounts(map: ArticleCountMap): string {
  const parts = [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a - b)
    .map(([articleId, count]) => `Article${String(articleId).padStart(2, "0")}: ${count}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatNoteCounts(map: NoteCountMap): string {
  const parts = Object.entries(NOTE_CATEGORY_LABELS)
    .map(([category, label]) => `${label}:${map.get(category) ?? 0}`)
    .filter((item) => !item.endsWith(":0"));
  return parts.length > 0 ? parts.join(", ") : "none";
}

function extractArticleId(item: unknown): number {
  if (!item || typeof item !== "object") return 0;
  const candidate = item as { article_id?: number | null; articleId?: number | null; primary_article_id?: number | null; top_findings?: unknown[] };
  const direct = Number(candidate.article_id ?? candidate.articleId ?? candidate.primary_article_id ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 0;
}

function countArticlesFromFindings(findings: readonly unknown[] | null | undefined): ArticleCountMap {
  const counts = new Map<number, number>();
  for (const item of findings ?? []) {
    const articleId = extractArticleId(item);
    if (!articleId) continue;
    counts.set(articleId, (counts.get(articleId) ?? 0) + 1);
  }
  return counts;
}

function countArticlesFromSummaryArticles(articles: readonly unknown[] | null | undefined): ArticleCountMap {
  const counts = new Map<number, number>();
  for (const article of articles ?? []) {
    const articleId = extractArticleId(article);
    if (!articleId) continue;
    const topFindings = Array.isArray((article as { top_findings?: unknown[] }).top_findings)
      ? (article as { top_findings?: unknown[] }).top_findings ?? []
      : [];
    counts.set(articleId, topFindings.length);
  }
  return counts;
}

function sumMapCounts(map: ArticleCountMap): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

function mergeArticleCounts(target: ArticleCountMap, source: ArticleCountMap): void {
  for (const [articleId, count] of source.entries()) {
    addCount(target, articleId, count);
  }
}

function mergeNoteCounts(target: NoteCountMap, source: Record<string, number> | null | undefined): void {
  if (!source) return;
  for (const [category, count] of Object.entries(source)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    target.set(category, (target.get(category) ?? 0) + count);
  }
}

export function recordPipelineStageTelemetry(args: {
  jobId: string;
  stageName: typeof STAGE_ORDER[number];
  inputCount?: number | null;
  outputCount: number;
  articleCounts?: ArticleCountMap | Record<number, number> | null;
}): void {
  const job = getJobTelemetry(args.jobId);
  const stage = ensureStage(job, args.stageName);
  if (args.inputCount != null && Number.isFinite(args.inputCount)) {
    stage.inputTotal = (stage.inputTotal ?? 0) + args.inputCount;
  }
  stage.outputTotal += Number.isFinite(args.outputCount) ? args.outputCount : 0;
  const sourceCounts = args.articleCounts instanceof Map
    ? args.articleCounts
    : new Map(
        Object.entries(args.articleCounts ?? {}).map(([key, value]) => [Number(key), Number(value)] as const)
      );
  mergeArticleCounts(stage.articleCounts, sourceCounts);
}

export function recordPipelineNotesTelemetry(args: {
  jobId: string;
  noteCounts: Record<string, number>;
}): void {
  const job = getJobTelemetry(args.jobId);
  mergeNoteCounts(job.notesByCategory, args.noteCounts);
}

export function recordPipelineNotesFromRows(args: {
  jobId: string;
  notes: Array<{ category: string }>;
}): void {
  const counts: Record<string, number> = {};
  for (const note of args.notes) {
    const key = String(note.category ?? "").trim();
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  recordPipelineNotesTelemetry({ jobId: args.jobId, noteCounts: counts });
}

export function recordTelemetryFromFindings(args: {
  jobId: string;
  stageName: typeof STAGE_ORDER[number];
  inputCount?: number | null;
  findings: readonly unknown[];
}): void {
  recordPipelineStageTelemetry({
    jobId: args.jobId,
    stageName: args.stageName,
    inputCount: args.inputCount ?? null,
    outputCount: args.findings.length,
    articleCounts: countArticlesFromFindings(args.findings),
  });
}

export function recordTelemetryFromSummary(args: {
  jobId: string;
  stageName: "aggregation" | "report";
  inputCount?: number | null;
  summaryArticles: readonly unknown[];
  noteSummary?: Record<string, number>;
}): void {
  recordPipelineStageTelemetry({
    jobId: args.jobId,
    stageName: args.stageName,
    inputCount: args.inputCount ?? null,
    outputCount: sumMapCounts(countArticlesFromSummaryArticles(args.summaryArticles)),
    articleCounts: countArticlesFromSummaryArticles(args.summaryArticles),
  });
  if (args.noteSummary) {
    recordPipelineNotesTelemetry({ jobId: args.jobId, noteCounts: args.noteSummary });
  }
}

function formatStageLine(stageName: typeof STAGE_ORDER[number], stage: StageTelemetry | undefined): string[] {
  const labelMap: Record<typeof STAGE_ORDER[number], string> = {
    reviewer_output: "Reviewer Output",
    merge: "Multi-pass Merge",
    validator: "Validator",
    auditor: "Auditor",
    persistence: "Persistence",
    aggregation: "Aggregation",
    report: "Report",
  };
  const lines: string[] = [`${labelMap[stageName]}:`];
  if (!stage) {
    lines.push("  Total: 0");
    return lines;
  }
  if (stageName === "reviewer_output") {
    lines.push(`  Total: ${stage.outputTotal}`);
  } else if (stage.inputTotal != null) {
    lines.push(`  ${stage.inputTotal} -> ${stage.outputTotal}`);
  } else {
    lines.push(`  Total: ${stage.outputTotal}`);
  }
  const articleCounts = formatArticleCounts(stage.articleCounts);
  lines.push(`  Findings per article: ${articleCounts}`);
  return lines;
}

export function emitPipelineTelemetryBlock(args: { jobId: string }): void {
  const job = JOB_TELEMETRY.get(args.jobId);
  if (!job || job.emitted) return;

  const lines = ["===== FINDING PIPELINE ====="];
  for (const stageName of STAGE_ORDER) {
    lines.push(...formatStageLine(stageName, job.stages[stageName]));
  }
  lines.push(`Notes: ${formatNoteCounts(job.notesByCategory)}`);
  lines.push("===========================");
  logger.info(lines.join("\n"), { jobId: args.jobId });
  job.emitted = true;
  JOB_TELEMETRY.delete(args.jobId);
}

