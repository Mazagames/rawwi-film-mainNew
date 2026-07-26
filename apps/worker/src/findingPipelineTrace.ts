import { config } from "./config.js";
import { canonicalStringify } from "./canonicalJson.js";
import { logger } from "./logger.js";

export type FindingPipelineTraceSnapshot = {
  traceId: string;
  findingUuid: string | null;
  reviewerArticleId: number | null;
  passName: string | null;
  eventId: number | null;
  pageNumber: number | null;
  title_ar: string | null;
  description_ar: string | null;
  rationale_ar: string | null;
  canonical_atom: string | null;
  article_id: number | null;
  claimedArticleId: number | null;
  severity: string | null;
  confidence: number | null;
  evidence_snippet: string | null;
  quote: string | null;
  start_offset: number | null;
  end_offset: number | null;
  validatorDecision?: string | null;
  dropReason?: string | null;
  bypassReason?: string | null;
  insertedFindingId?: string | null;
  canonicalFindingId?: string | null;
};

type TraceSessionSummary = {
  reviewerCreated: number;
  validatorRemoved: number;
  persistenceRemoved: number;
  aggregationChangedArticle: number;
  aggregationChangedTitle: number;
  reportRendered: number;
  functions: Set<string>;
};

type TraceSession = {
  trackedTraceIds: string[];
  previousSnapshots: Map<string, FindingPipelineTraceSnapshot>;
  canonicalAlias: Map<string, string>;
  insertedAlias: Map<string, string>;
  summary: TraceSessionSummary;
};

const SESSIONS = new Map<string, TraceSession>();
const TRACE_LIMIT = 5;

function sessionKey(jobId: string, chunkId: string): string {
  return jobId;
}

function shouldTrace(): boolean {
  return config.DEBUG_TRACE_FINDING_PIPELINE;
}

function getSession(jobId: string, chunkId: string): TraceSession {
  const key = sessionKey(jobId, chunkId);
  const existing = SESSIONS.get(key);
  if (existing) return existing;
  const created: TraceSession = {
    trackedTraceIds: [],
    previousSnapshots: new Map(),
    canonicalAlias: new Map(),
    insertedAlias: new Map(),
    summary: {
      reviewerCreated: 0,
      validatorRemoved: 0,
      persistenceRemoved: 0,
      aggregationChangedArticle: 0,
      aggregationChangedTitle: 0,
      reportRendered: 0,
      functions: new Set<string>(),
    },
  };
  SESSIONS.set(key, created);
  return created;
}

function normalizeValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return canonicalStringify(value);
}

function snapshotField(snapshot: FindingPipelineTraceSnapshot, field: keyof FindingPipelineTraceSnapshot): unknown {
  return snapshot[field];
}

function diffSnapshot(previous: FindingPipelineTraceSnapshot, current: FindingPipelineTraceSnapshot): Array<{
  field: keyof FindingPipelineTraceSnapshot;
  before: unknown;
  after: unknown;
}> {
  const fields: Array<keyof FindingPipelineTraceSnapshot> = [
    "findingUuid",
    "eventId",
    "reviewerArticleId",
    "claimedArticleId",
    "pageNumber",
    "title_ar",
    "canonical_atom",
    "description_ar",
    "rationale_ar",
    "severity",
    "confidence",
    "evidence_snippet",
    "start_offset",
    "end_offset",
    "article_id",
    "validatorDecision",
    "dropReason",
    "bypassReason",
  ];
  return fields
    .map((field) => ({
      field,
      before: snapshotField(previous, field),
      after: snapshotField(current, field),
    }))
    .filter((item) => normalizeValue(item.before) !== normalizeValue(item.after));
}

function resolveTraceId(snapshot: FindingPipelineTraceSnapshot, session: TraceSession): string {
  if (snapshot.traceId.trim()) return snapshot.traceId;
  if (snapshot.canonicalFindingId && session.canonicalAlias.has(snapshot.canonicalFindingId)) {
    return session.canonicalAlias.get(snapshot.canonicalFindingId) ?? snapshot.traceId;
  }
  if (snapshot.insertedFindingId && session.insertedAlias.has(snapshot.insertedFindingId)) {
    return session.insertedAlias.get(snapshot.insertedFindingId) ?? snapshot.traceId;
  }
  return snapshot.traceId;
}

function logSnapshot(stageName: string, traceId: string, snapshot: FindingPipelineTraceSnapshot) {
  logger.info("TRACE FINDING PIPELINE SNAPSHOT", {
    traceId,
    findingUuid: snapshot.findingUuid,
    stage: stageName,
    reviewerArticleId: snapshot.reviewerArticleId,
    passName: snapshot.passName,
    eventId: snapshot.eventId,
    pageNumber: snapshot.pageNumber,
    title_ar: snapshot.title_ar,
    description_ar: snapshot.description_ar,
    rationale_ar: snapshot.rationale_ar,
    canonical_atom: snapshot.canonical_atom,
    article_id: snapshot.article_id,
    claimedArticleId: snapshot.claimedArticleId,
    severity: snapshot.severity,
    confidence: snapshot.confidence,
    evidence_snippet: snapshot.evidence_snippet,
    quote: snapshot.quote,
    start_offset: snapshot.start_offset,
    end_offset: snapshot.end_offset,
    validatorDecision: snapshot.validatorDecision ?? null,
    dropReason: snapshot.dropReason ?? null,
    bypassReason: snapshot.bypassReason ?? null,
    insertedFindingId: snapshot.insertedFindingId ?? null,
    canonicalFindingId: snapshot.canonicalFindingId ?? null,
  });
}

function logMutation(
  traceId: string,
  stageName: string,
  field: keyof FindingPipelineTraceSnapshot,
  before: unknown,
  after: unknown,
  functionName: string,
) {
  logger.info([
    "==========================",
    "TRACE MUTATION",
    `trace_id: ${traceId}`,
    `Stage: ${stageName}`,
    `Field: ${String(field)}`,
    `Before: ${normalizeValue(before)}`,
    `After: ${normalizeValue(after)}`,
    `Reason: ${functionName}`,
    "==========================",
  ].join("\n"));
}

function logRemoval(traceId: string, stageName: string, snapshot: FindingPipelineTraceSnapshot, functionName: string) {
  logger.info([
    "==========================",
    "TRACE REMOVAL",
    `trace_id: ${traceId}`,
    `Stage: ${stageName}`,
    `Reason: ${functionName}`,
    `LastKnownFindingUuid: ${normalizeValue(snapshot.findingUuid)}`,
    `LastKnownTitle: ${normalizeValue(snapshot.title_ar)}`,
    `LastKnownArticle: ${normalizeValue(snapshot.article_id)}`,
    `LastKnownPage: ${normalizeValue(snapshot.pageNumber)}`,
    `LastKnownEvidence: ${normalizeValue(snapshot.evidence_snippet)}`,
    "==========================",
  ].join("\n"));
}

export function traceFindingPipelineStage(args: {
  jobId: string;
  chunkId: string;
  stageName: string;
  snapshots: FindingPipelineTraceSnapshot[];
  functionName: string;
  maxTracked?: number;
  reportRenderedCount?: number;
}): void {
  if (!shouldTrace()) return;
  const session = getSession(args.jobId, args.chunkId);
  const limit = args.maxTracked ?? TRACE_LIMIT;

  if (session.trackedTraceIds.length < limit) {
    for (const snapshot of args.snapshots) {
      if (session.trackedTraceIds.length >= limit) break;
      const traceId = resolveTraceId(snapshot, session);
      if (!traceId.trim() || session.trackedTraceIds.includes(traceId)) continue;
      session.trackedTraceIds.push(traceId);
    }
    if (session.summary.reviewerCreated === 0) {
      session.summary.reviewerCreated = session.trackedTraceIds.length;
    }
  }

  const trackedSnapshots = args.snapshots
    .map((snapshot) => ({ snapshot, traceId: resolveTraceId(snapshot, session) }))
    .filter(({ traceId }) => session.trackedTraceIds.includes(traceId));

  const seenTraceIds = new Set<string>();
  for (const { snapshot, traceId } of trackedSnapshots) {
    seenTraceIds.add(traceId);
    const previous = session.previousSnapshots.get(traceId);
    logSnapshot(args.stageName, traceId, snapshot);
    if (snapshot.validatorDecision === "rejected") {
      session.summary.validatorRemoved++;
    }
    if (previous) {
      for (const change of diffSnapshot(previous, snapshot)) {
        logMutation(traceId, args.stageName, change.field, change.before, change.after, args.functionName);
        if (change.field === "article_id" && normalizeValue(change.before) !== normalizeValue(change.after)) {
          session.summary.aggregationChangedArticle++;
        }
        if (change.field === "title_ar" && normalizeValue(change.before) !== normalizeValue(change.after)) {
          session.summary.aggregationChangedTitle++;
        }
        session.summary.functions.add(args.functionName);
      }
    }
    if (snapshot.canonicalFindingId) {
      session.canonicalAlias.set(snapshot.canonicalFindingId, traceId);
    }
    if (snapshot.insertedFindingId) {
      session.insertedAlias.set(snapshot.insertedFindingId, traceId);
    }
    session.previousSnapshots.set(traceId, snapshot);
  }

  const missingTraceIds = session.trackedTraceIds.filter((traceId) => !seenTraceIds.has(traceId));
  for (const traceId of missingTraceIds) {
    const previous = session.previousSnapshots.get(traceId);
    if (!previous) continue;
    logRemoval(traceId, args.stageName, previous, args.functionName);
    if (args.stageName.toLowerCase().includes("validator") && previous.validatorDecision !== "rejected") {
      session.summary.validatorRemoved++;
    } else if (args.stageName.toLowerCase().includes("insert")) {
      session.summary.persistenceRemoved++;
    }
  }

  if (typeof args.reportRenderedCount === "number") {
    session.summary.reportRendered = args.reportRenderedCount;
  }
}

export function traceFindingPipelineSummary(jobId: string, chunkId: string): void {
  if (!shouldTrace()) return;
  const session = SESSIONS.get(sessionKey(jobId, chunkId));
  if (!session) return;

  logger.info("TRACE PIPELINE MUTATION SUMMARY", {
    jobId,
    chunkId,
    reviewerCreated: session.summary.reviewerCreated,
    validatorRemoved: session.summary.validatorRemoved,
    persistenceRemoved: session.summary.persistenceRemoved,
    aggregationChangedArticle: session.summary.aggregationChangedArticle,
    aggregationChangedTitle: session.summary.aggregationChangedTitle,
    reportRendered: session.summary.reportRendered,
    functions: [...session.summary.functions],
  });
}
