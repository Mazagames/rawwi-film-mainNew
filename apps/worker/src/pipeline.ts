import { supabase } from "./db.js";
import { ALWAYS_CHECK_ARTICLES, getScriptStandardArticle, type GCAMArticle } from "./gcam.js";
import { evidenceHash, lexiconEvidenceHash, computeChunkRunKey } from "./hash.js";
import type { AnalysisChunk, AnalysisJob } from "./jobs.js";
import {
  incrementJobProgress,
  isJobCancelled,
  setChunkDone,
  setChunkFailed,
  setChunkPhase,
  setChunkMultipassStart,
} from "./jobs.js";
import { analyzeLexiconMatches } from "./lexiconMatcher.js";
import { findStringMatches, getLexiconCache } from "./lexiconCache.js";
import { logger } from "./logger.js";
import { buildRouterTraceSummary, callJudgeRaw, callRouter, parseJudgeWithRepair } from "./openai.js";
import { config } from "./config.js";
import { isValidAtomForArticle, normalizeAtomId } from "./policyMap.js";
import type { JudgeFinding } from "./schemas.js";
import { runNotesDetection, toNoteInsertRows } from "./noteDetection.js";
import { getScriptStandardRouterList } from "./gcam.js";
import { ROUTER_SYSTEM_MSG, JUDGE_SYSTEM_MSG, injectLexiconIntoPrompts, PROMPT_VERSIONS } from "./aiConstants.js";
import { runMultiPassDetection, DETECTION_PASSES, planDetectionPassExecution, type LexiconTerm } from "./multiPassJudge.js";
import { PASS_GATING_VERSION } from "./passGating.js";
import { normalizeFindingTitleDecision } from "./findingTitleNormalize.js";
import { persistJudgeDiagnostic } from "./judgeDiagnostics.js";
import { buildReviewerBenchmarkHtml, buildReviewerBenchmarkReport, toReviewerBenchmarkLog } from "./reviewerBenchmark.js";
import { buildValidatorAuditHtml, buildValidatorAuditReport, toValidatorAuditLog } from "./validatorAudit.js";
import { buildReviewerTraceReport, toReviewerTraceLog } from "./reviewerTrace.js";
import { traceFindingPipelineStage, traceFindingPipelineSummary, type FindingPipelineTraceSnapshot } from "./findingPipelineTrace.js";
import { recordTelemetryFromFindings } from "./pipelineTelemetry.js";
import { countNoteCategoriesFromArray, logNotePipelineStage } from "./notePipelineTelemetry.js";
import { upsertFindingPolicyLinks } from "./policyLinks.js";
import { calculateSeverity } from "./severityRulebook.js";
import { getPrimaryCanonicalAtomForGcam } from "./canonicalAtomMapping.js";
import { getAtomDefinition } from "./canonicalAtomFramework.js";
import { offsetToPageNumber, computePageLocalSpan, globalOffsetForPageStart, SCRIPT_PAGE_SEPARATOR } from "./offsetToPage.js";
import { getCachedJobResources } from "./jobAnalysisCache.js";
import { refineAtomPrecision } from "./atomPrecision.js";
import { sha256 } from "./hash.js";
import { isDetectionVerbatim } from "./textDetectionNormalize.js";
import { PIPELINE_V2_EVIDENCE_PINNING_VERSION, pinFindingEvidenceToChunk } from "./pipelineV2/evidencePinning.js";
import { PIPELINE_V2_MEMORY_VERSION } from "./pipelineV2/contextMemory.js";
import { PIPELINE_V2_SCENE_MEMORY_VERSION } from "./pipelineV2/sceneMemory.js";
import { PIPELINE_V2_SCRIPT_MEMORY_VERSION } from "./pipelineV2/scriptMemory.js";
import { PIPELINE_EVIDENCE_GROUNDING_VERSION, groundFindingEvidenceToChunk } from "./evidenceGrounding.js";
import { getEventConsistencyIssue } from "./eventConsistency.js";
import type { StructuredEvent } from "./eventUnderstanding.js";
import { V3_SUBJECT_DEFINITIONS } from "./v3PromptPack.js";
import { buildLineageEvent, ensureFindingLineageId, persistLineageEvents } from "./findingLineage.js";
import { buildFindingUuid } from "./findingIdentity.js";
import { canonicalStringify } from "./canonicalJson.js";

export type FindingWithGlobal = JudgeFinding & {
  source?: "ai" | "lexicon_mandatory" | "manual";
  start_offset_global: number;
  end_offset_global: number;
  page_number?: number | null;
  lineage_id?: string | null;
  parent_lineage_id?: string | null;
  finding_uuid?: string | null;
  canonical_hash?: string | null;
  evidence_hash?: string | null;
  policy_links?: Array<{ article_id: number; atom_concept_id?: string | null; role?: string | null }>;
  primary_article_id?: number | null;
  related_article_ids?: number[];
  canonical_finding_id?: string | null;
  pillar_id?: string | null;
  secondary_pillar_ids?: string[];
};

type MultiPassDetectionResult = Awaited<ReturnType<typeof runMultiPassDetection>>;
type BenchmarkInstrumentationArgs = {
  jobId: string;
  chunkId: string;
  runKey: string;
  chunkStart: number;
  chunkEnd: number;
  chunkText: string;
  routerOutputJson: unknown;
  job: AnalysisJob;
  chunk: AnalysisChunk;
  allFindings: FindingWithGlobal[];
  resolvedFindings: FindingWithGlobal[];
  multiPassEventUnderstanding: MultiPassDetectionResult["eventUnderstanding"];
  multiPassPassResults: MultiPassDetectionResult["passResults"];
};

type AnalysisEngineMode = "v2";

function buildTraceSnapshotFromFinding(
  finding: FindingWithGlobal,
  args: {
    traceId: string;
    reviewerArticleId: number | null;
    passName: string | null;
    eventId?: number | null;
    validatorDecision?: string | null;
    dropReason?: string | null;
    bypassReason?: string | null;
    insertedFindingId?: string | null;
    canonicalFindingId?: string | null;
  },
): FindingPipelineTraceSnapshot {
  return {
    traceId: args.traceId,
    findingUuid: finding.finding_uuid ?? finding.lineage_id ?? null,
    reviewerArticleId: args.reviewerArticleId,
    passName: args.passName,
    eventId: args.eventId ?? getFindingDeclaredEventId(finding),
    pageNumber: finding.page_number ?? null,
    title_ar: finding.title_ar ?? null,
    description_ar: finding.description_ar ?? null,
    rationale_ar: finding.rationale_ar ?? null,
    canonical_atom: finding.canonical_atom ?? null,
    article_id: finding.article_id ?? null,
    claimedArticleId: finding.article_id ?? null,
    severity: finding.severity ?? null,
    confidence: finding.confidence ?? null,
    evidence_snippet: finding.evidence_snippet ?? null,
    quote: finding.evidence_snippet ?? null,
    start_offset: finding.start_offset_global ?? null,
    end_offset: finding.end_offset_global ?? null,
    validatorDecision: args.validatorDecision ?? null,
    dropReason: args.dropReason ?? null,
    bypassReason: args.bypassReason ?? null,
    insertedFindingId: args.insertedFindingId ?? null,
    canonicalFindingId: args.canonicalFindingId ?? null,
  };
}

function getFindingDeclaredEventId(finding: FindingWithGlobal): number | null {
  const direct = typeof finding.event_id === "number" ? finding.event_id : null;
  if (Number.isInteger(direct) && (direct ?? 0) > 0) return direct;
  const nested = (finding.location as { v3?: { event_id?: unknown } } | null | undefined)?.v3?.event_id;
  if (typeof nested === "number" && Number.isInteger(nested) && nested > 0) return nested;
  return null;
}

function getStructuredEventById(events: StructuredEvent[], eventId: number | null): StructuredEvent | null {
  if (!Number.isInteger(eventId ?? null)) return null;
  return events.find((event) => event.event_id === eventId) ?? null;
}

function logEvidenceIntegrityFailure(args: {
  jobId: string;
  chunkId: string;
  runKey: string;
  finding: FindingWithGlobal;
  findingUuid: string;
  expectedEvent: number | null;
  actualEvent: number | null;
}): void {
  logger.error("EVIDENCE INTEGRITY FAILURE", {
    jobId: args.jobId,
    chunkId: args.chunkId,
    runKey: args.runKey,
    findingUuid: args.findingUuid,
    expectedEvent: args.expectedEvent,
    actualEvent: args.actualEvent,
    pageNumber: args.finding.page_number ?? null,
    evidenceSnippet: (args.finding.evidence_snippet ?? "").slice(0, 200),
    title_ar: args.finding.title_ar ?? null,
    rationale_ar: args.finding.rationale_ar ?? null,
  });
}

function logValidatorRejection(args: {
  jobId: string;
  chunkId: string;
  runKey: string;
  stage: string;
  rule: string;
  rejectionReason: string;
  finding: FindingWithGlobal;
  findingUuid?: string | null;
  eventId?: number | null;
}): void {
  logger.error("Validator rejected finding", {
    jobId: args.jobId,
    chunkId: args.chunkId,
    runKey: args.runKey,
    stage: args.stage,
    finding_uuid: args.findingUuid ?? args.finding.finding_uuid ?? args.finding.lineage_id ?? null,
    article: args.finding.article_id ?? null,
    validatorRule: args.rule,
    rejectionReason: args.rejectionReason,
    event_id: args.eventId ?? getFindingDeclaredEventId(args.finding),
    evidenceSnippet: (args.finding.evidence_snippet ?? "").slice(0, 240),
    title_ar: args.finding.title_ar ?? null,
    rationale_ar: args.finding.rationale_ar ?? null,
  });
}

function buildTraceSnapshotFromRow(
  row: Record<string, unknown>,
  args: {
    traceId: string;
    reviewerArticleId: number | null;
    passName: string | null;
    eventId?: number | null;
    validatorDecision?: string | null;
    dropReason?: string | null;
    bypassReason?: string | null;
    insertedFindingId?: string | null;
    canonicalFindingId?: string | null;
  },
): FindingPipelineTraceSnapshot {
  return {
    traceId: args.traceId,
    findingUuid: row.finding_uuid ?? row.lineage_id ?? null,
    reviewerArticleId: args.reviewerArticleId,
    passName: args.passName,
    eventId: args.eventId ?? getRowEventId(row),
    pageNumber: typeof row.page_number === "number" ? row.page_number : null,
    title_ar: typeof row.title_ar === "string" ? row.title_ar : null,
    description_ar: typeof row.description_ar === "string" ? row.description_ar : null,
    rationale_ar: typeof row.rationale_ar === "string" ? row.rationale_ar : null,
    canonical_atom: typeof row.canonical_atom === "string" ? row.canonical_atom : null,
    article_id: typeof row.article_id === "number" ? row.article_id : null,
    claimedArticleId: typeof row.article_id === "number" ? row.article_id : null,
    severity: typeof row.severity === "string" ? row.severity : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    evidence_snippet: typeof row.evidence_snippet === "string" ? row.evidence_snippet : null,
    quote: typeof row.evidence_snippet === "string" ? row.evidence_snippet : null,
    start_offset: typeof row.start_offset_global === "number" ? row.start_offset_global : null,
    end_offset: typeof row.end_offset_global === "number" ? row.end_offset_global : null,
    validatorDecision: args.validatorDecision ?? null,
    dropReason: args.dropReason ?? null,
    bypassReason: args.bypassReason ?? null,
    insertedFindingId: args.insertedFindingId ?? null,
    canonicalFindingId: args.canonicalFindingId ?? null,
  };
}

function getRowEventId(row: Record<string, unknown>): number | null {
  const nested = (row.location as { v3?: { event_id?: unknown } } | undefined)?.v3?.event_id;
  if (typeof nested === "number" && Number.isInteger(nested) && nested > 0) return nested;
  return null;
}

function parseReviewerArticleId(passName: string | null | undefined, fallback: number | null = null): number | null {
  if (!passName) return fallback;
  const match = /^v5_article_(\d{2})$/i.exec(passName.trim());
  if (!match) return fallback;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(value) ? value : fallback;
}

const MAX_EVIDENCE_SPAN = 280;
const PIPELINE_LOGIC_VERSION = "v2.10";
const MAX_EVIDENCE_LEN = 260;
const NON_CRITICAL_DB_TIMEOUT_MS = 30_000;
const CRITICAL_DB_TIMEOUT_MS = 60_000;
const HARD_FALLBACK_INSULTS = [
  { term: "نصاب", articleId: 5, atomId: "5-2", severity: "high" as const },
  { term: "حرامي", articleId: 5, atomId: "5-2", severity: "high" as const },
  { term: "كذاب", articleId: 5, atomId: "5-2", severity: "medium" as const },
  { term: "محتال", articleId: 5, atomId: "5-2", severity: "high" as const },
  { term: "لص", articleId: 5, atomId: "5-2", severity: "medium" as const },
] as const;

async function isPartialFinalizeRequested(jobId: string): Promise<boolean> {
  try {
    const result: {
      data: { partial_finalize_requested?: boolean | null } | null;
      error: { message: string } | null;
    } = await withOperationTimeout<{
      data: { partial_finalize_requested?: boolean | null } | null;
      error: { message: string } | null;
    }>(
      "Read job partial finalize state",
      NON_CRITICAL_DB_TIMEOUT_MS,
      supabase
        .from("analysis_jobs")
        .select("partial_finalize_requested")
        .eq("id", jobId)
        .maybeSingle()
    );
    const { data, error } = result;

    if (error) {
      logger.warn("Failed to read job partial finalize state during chunk processing", {
        jobId,
        error: error.message,
      });
      return false;
    }

    return Boolean((data as { partial_finalize_requested?: boolean | null } | null)?.partial_finalize_requested);
  } catch (error) {
    logger.warn("Timed out reading job partial finalize state during chunk processing", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
      timeoutMs: NON_CRITICAL_DB_TIMEOUT_MS,
    });
    return false;
  }
}

async function runBenchmarkInstrumentation(args: BenchmarkInstrumentationArgs): Promise<void> {
  if (config.VIOLATION_SYSTEM_VERSION !== "v5" || !args.multiPassEventUnderstanding) {
    return;
  }

  try {
    const originalUnderstanding = {
      chunk_start: args.multiPassEventUnderstanding.chunk_start,
      chunk_end: args.multiPassEventUnderstanding.chunk_end,
      event_count: args.multiPassEventUnderstanding.original_event_count ?? args.multiPassEventUnderstanding.event_count,
      events: args.multiPassEventUnderstanding.original_events ?? args.multiPassEventUnderstanding.events,
    };
    const verificationResult = args.multiPassEventUnderstanding.verification ?? null;
    const finalCorrectedUnderstanding = {
      chunk_start: args.multiPassEventUnderstanding.chunk_start,
      chunk_end: args.multiPassEventUnderstanding.chunk_end,
      event_count: args.multiPassEventUnderstanding.event_count,
      events: args.multiPassEventUnderstanding.events,
    };

    if (config.ANALYSIS_EVAL_LOG) {
      await persistJudgeDiagnostic({
        diagnostic_kind: "understanding_snapshot",
        job_id: args.job.id,
        chunk_id: args.chunk.id,
        pass_name: "event_understanding",
        prompt_hash: "",
        router_candidates: null,
        raw_judge_response: JSON.stringify({
          original_understanding: originalUnderstanding,
          verification_result: verificationResult,
          final_corrected_json: finalCorrectedUnderstanding,
        }),
        rendered_system_prompt: null,
        rendered_user_prompt: null,
        parsed_judge_response: {
          original_understanding: originalUnderstanding,
          verification_result: verificationResult,
          final_corrected_json: finalCorrectedUnderstanding,
        },
        raw_finding_count: 0,
        parsed_finding_count: 0,
        finding_count: 0,
        judge_model: config.OPENAI_JUDGE_MODEL,
        finish_reason: null,
        openai_usage: null,
        openai_response_id: null,
        raw_response_timestamp: new Date().toISOString(),
      });
      logger.info("Understanding snapshot persisted", {
        chunkId: args.chunk.id,
        eventCount: args.multiPassEventUnderstanding.event_count,
        originalEventCount: originalUnderstanding.event_count,
        verificationStatus: verificationResult?.status ?? "none",
      });
    }

    const reviewerBenchmarkReport = buildReviewerBenchmarkReport({
      chunkStart: args.chunkStart,
      chunkEnd: args.chunkEnd,
      eventUnderstanding: args.multiPassEventUnderstanding,
      passResults: args.multiPassPassResults,
      finalFindings: args.allFindings,
    });
    const reviewerBenchmarkHtml = buildReviewerBenchmarkHtml(reviewerBenchmarkReport);
    logger.info("Reviewer benchmark report", toReviewerBenchmarkLog(reviewerBenchmarkReport));
    logger.info("Reviewer benchmark dashboard generated", {
      chunkId: args.chunk.id,
      htmlLength: reviewerBenchmarkHtml.length,
      reviewerCount: reviewerBenchmarkReport.summary.totalReviewers,
      eventCount: reviewerBenchmarkReport.eventCount,
      falsePositiveCount: reviewerBenchmarkReport.falsePositives.length,
      falseNegativeCount: reviewerBenchmarkReport.falseNegatives.length,
    });

    const validatorAuditReport = buildValidatorAuditReport({
      chunkStart: args.chunkStart,
      chunkEnd: args.chunkEnd,
      chunkText: args.chunkText,
      eventUnderstanding: args.multiPassEventUnderstanding,
      passResults: args.multiPassPassResults,
      finalFindings: args.resolvedFindings,
      memory2Enabled: isMemory2Mode(args.job),
      useEventConsistencyChecks: config.VIOLATION_SYSTEM_VERSION === "v5",
    });
    const validatorAuditHtml = buildValidatorAuditHtml(validatorAuditReport);
    logger.info("Validator audit report", toValidatorAuditLog(validatorAuditReport));
    logger.info("Validator audit dashboard generated", {
      chunkId: args.chunk.id,
      htmlLength: validatorAuditHtml.length,
      rejectedFindings: validatorAuditReport.summary.totalRejectedFindings,
      falseRejects: validatorAuditReport.summary.totalFalseRejects,
    });

    if (config.ENABLE_REVIEWER_TRACE) {
      const reviewerTraceReport = buildReviewerTraceReport({
        chunkStart: args.chunkStart,
        chunkEnd: args.chunkEnd,
        eventUnderstanding: args.multiPassEventUnderstanding,
        passResults: args.multiPassPassResults,
        finalFindings: args.resolvedFindings,
        validatorAuditReport,
        decisionAudits: reviewerBenchmarkReport.decisionAudits,
      });
      logger.info("Reviewer trace report", toReviewerTraceLog(reviewerTraceReport));
      logger.info("Reviewer trace enabled", {
        chunkId: args.chunk.id,
        reviewerCount: reviewerTraceReport.summary.totalReviewers,
        eventCount: reviewerTraceReport.summary.totalEvents,
        findingsEmitted: reviewerTraceReport.summary.totalFindingsEmitted,
        verifierAccepted: reviewerTraceReport.summary.totalVerifierAccepted,
        verifierRejected: reviewerTraceReport.summary.totalVerifierRejected,
      });
    }
  } catch (error) {
    logger.warn("Benchmark instrumentation failed", {
      jobId: args.jobId,
      chunkId: args.chunk.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

class JobCancelledError extends Error {
  constructor() {
    super("Analysis cancelled by user.");
    this.name = "JobCancelledError";
  }
}

class OperationTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "OperationTimeoutError";
  }
}

async function withOperationTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: PromiseLike<T>
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new OperationTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(typeof reason === "string" ? reason : "Chunk processing aborted");
  error.name = "AbortError";
  throw error;
}

function compactEvidenceText(s: string): string {
  const cleaned = (s ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_EVIDENCE_LEN ? `${cleaned.slice(0, MAX_EVIDENCE_LEN)}…` : cleaned;
}

function requiresStrictExactProof(finding: JudgeFinding): boolean {
  const pass = String(finding.detection_pass ?? "").toLowerCase();
  return pass !== "" && pass !== "glossary";
}

function allowsStrictGroundingMethod(method: string): boolean {
  return method === "rationale_quote" || method === "evidence_exact";
}

function buildCanonicalAnchorPayload(args: {
  startGlobal: number | null | undefined;
  endGlobal: number | null | undefined;
  pageNumber?: number | null;
  pageRows: Array<{ page_number: number; content: string }>;
  anchorText?: string | null;
  documentContent?: string | null;
  method?: string;
}): Record<string, unknown> {
  const startGlobal = typeof args.startGlobal === "number" ? args.startGlobal : null;
  const endGlobal = typeof args.endGlobal === "number" ? args.endGlobal : null;
  const anchorText = typeof args.anchorText === "string" ? args.anchorText.trim() : "";
  const anchorUpdatedAt = new Date().toISOString();

  if (startGlobal == null || endGlobal == null || endGlobal <= startGlobal) {
    return {
      anchor_status: "unresolved",
      anchor_method: "unresolved",
      anchor_page_number: null,
      anchor_start_offset_page: null,
      anchor_end_offset_page: null,
      anchor_start_offset_global: null,
      anchor_end_offset_global: null,
      anchor_text: anchorText || null,
      anchor_confidence: 0,
      anchor_updated_at: anchorUpdatedAt,
    };
  }

  const normalizeAnchorNeedle = (value: string): string =>
    value
      .replace(/^[\s"'“”«»„]+|[\s"'“”«»„]+$/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  const canonicalNormalize = (value: string): string =>
    normalizeAnchorNeedle(value.normalize("NFC"));

  const gatherExactOccurrences = (plain: string, needle: string): Array<{ start: number; end: number }> => {
    const out: Array<{ start: number; end: number }> = [];
    if (!plain || !needle) return out;
    let pos = 0;
    while (pos <= plain.length) {
      const idx = plain.indexOf(needle, pos);
      if (idx < 0) break;
      out.push({ start: idx, end: idx + needle.length });
      pos = idx + 1;
    }
    return out;
  };

  const pickClosest = (
    matches: Array<{ start: number; end: number }>,
    hintStart?: number | null,
  ): { start: number; end: number } | null => {
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    if (typeof hintStart === "number" && Number.isFinite(hintStart)) {
      return (
        [...matches].sort((a, b) => {
          const da = Math.abs(a.start - hintStart);
          const db = Math.abs(b.start - hintStart);
          if (da !== db) return da - db;
          return a.start - b.start;
        })[0] ?? null
      );
    }
    return [...matches].sort((a, b) => a.start - b.start)[0] ?? null;
  };

  const orderedNeedles = (raw: string): string[] => {
    const trimmed = normalizeAnchorNeedle(raw);
    if (!trimmed) return [];
    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeAnchorNeedle(line))
      .filter(Boolean);
    const unique = new Set<string>();
    const out: string[] = [];
    const add = (value: string) => {
      const normalized = normalizeAnchorNeedle(value);
      if (!normalized || unique.has(normalized)) return;
      unique.add(normalized);
      out.push(normalized);
    };
    for (let i = lines.length - 1; i >= 0; i--) add(lines[i]);
    const colonTailIdx = Math.max(raw.lastIndexOf(":"), raw.lastIndexOf("："));
    if (colonTailIdx >= 0 && colonTailIdx < raw.length - 2) add(raw.slice(colonTailIdx + 1));
    add(trimmed);
    return out;
  };

  const locateStrictExact = (
    plain: string,
    hintStart?: number | null,
  ): { start: number; end: number } | null => {
    for (const needle of orderedNeedles(anchorText)) {
      const direct = pickClosest(gatherExactOccurrences(plain, needle), hintStart);
      if (direct) return direct;

      const collapsed = normalizeAnchorNeedle(needle);
      if (collapsed && collapsed !== needle) {
        const collapsedHit = pickClosest(gatherExactOccurrences(plain, collapsed), hintStart);
        if (collapsedHit) return collapsedHit;
      }

      const canonicalNeedle = canonicalNormalize(needle);
      if (canonicalNeedle) {
        const canonicalMatches = gatherExactOccurrences(plain, needle).filter(
          (match) => canonicalNormalize(plain.slice(match.start, match.end)) === canonicalNeedle,
        );
        const canonicalHit = pickClosest(canonicalMatches, hintStart);
        if (canonicalHit) return canonicalHit;
      }
    }
    return null;
  };

  const pageNumber = args.pageNumber ?? offsetToPageNumber(startGlobal, args.pageRows);
  const pageStart = pageNumber != null ? globalOffsetForPageStart(pageNumber, args.pageRows) : null;
  const page = pageNumber != null ? args.pageRows.find((row) => row.page_number === pageNumber) ?? null : null;
  if (page && pageStart != null && anchorText) {
    const hintLocal = Math.max(0, startGlobal - pageStart);
    const pageHit = locateStrictExact(page.content ?? "", hintLocal);
    if (pageHit) {
      return {
        anchor_status: "exact",
        anchor_method: "page_exact",
        anchor_page_number: page.page_number,
        anchor_start_offset_page: pageHit.start,
        anchor_end_offset_page: pageHit.end,
        anchor_start_offset_global: pageStart + pageHit.start,
        anchor_end_offset_global: pageStart + pageHit.end,
        anchor_text: anchorText || null,
        anchor_confidence: 1,
        anchor_updated_at: anchorUpdatedAt,
      };
    }
  }

  const documentContent =
    typeof args.documentContent === "string" && args.documentContent.length > 0
      ? args.documentContent
      : args.pageRows.length > 0
        ? args.pageRows.map((row) => row.content ?? "").join(SCRIPT_PAGE_SEPARATOR)
        : "";
  if (documentContent && anchorText) {
    const documentHit = locateStrictExact(documentContent, startGlobal);
    if (documentHit) {
      const hitPageNumber = offsetToPageNumber(documentHit.start, args.pageRows);
      const pageLocal = computePageLocalSpan(documentHit.start, documentHit.end, args.pageRows);
      return {
        anchor_status: "exact",
        anchor_method: "document_exact",
        anchor_page_number: hitPageNumber,
        anchor_start_offset_page: pageLocal.start_offset_page,
        anchor_end_offset_page: pageLocal.end_offset_page,
        anchor_start_offset_global: documentHit.start,
        anchor_end_offset_global: documentHit.end,
        anchor_text: anchorText || null,
        anchor_confidence: 1,
        anchor_updated_at: anchorUpdatedAt,
      };
    }
  }

  const pageLocal = computePageLocalSpan(startGlobal, endGlobal, args.pageRows);
  return {
    anchor_status: "exact",
    anchor_method: args.method ?? "stored_offsets",
    anchor_page_number: pageNumber ?? null,
    anchor_start_offset_page: pageLocal.start_offset_page,
    anchor_end_offset_page: pageLocal.end_offset_page,
    anchor_start_offset_global: startGlobal,
    anchor_end_offset_global: endGlobal,
    anchor_text: anchorText || null,
    anchor_confidence: 1,
    anchor_updated_at: anchorUpdatedAt,
  };
}

function buildLexiconMandatoryRationale(args: {
  term: string;
  evidence: string;
  articleId: number;
  atomId: string | null;
  articleTitleAr?: string | null;
}): string {
  const evidence = compactEvidenceText(args.evidence);
  const articleRef = args.atomId
    ? `المادة ${args.articleId} (${args.atomId})`
    : `المادة ${args.articleId}`;
  const articleTitle = args.articleTitleAr?.trim() ? ` ${args.articleTitleAr.trim()}` : "";
  return `المقتطف يتضمن المصطلح "${args.term}" كما ورد في النص: "${evidence}". هذا اللفظ مرتبط في القاموس الإلزامي بـ${articleRef}${articleTitle ? ` - ${articleTitle}` : ""} لذلك رُصد كمؤشر مخالفة مباشر يحتاج تحققاً سياقياً عند المراجعة النهائية.`;
}

function buildDirectInsultRationale(args: {
  term: string;
  evidence: string;
  articleId: number;
  atomId: string | null;
}): string {
  const evidence = compactEvidenceText(args.evidence);
  const articleRef = args.atomId
    ? `المادة ${args.articleId} (${args.atomId})`
    : `المادة ${args.articleId}`;
  return `المقتطف يحتوي إهانة أو وصفاً مهيناً مباشراً باللفظ "${args.term}" ضمن العبارة: "${evidence}". لذلك صُنّف كمخالفة لفظية مباشرة تحت ${articleRef} وليس مجرد وصف محايد أو تقني.`;
}

function getLineNumberAt(text: string, index: number): number {
  if (index <= 0) return 1;
  let lines = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") lines++;
  }
  return lines;
}

/**
 * Build micro-windows for long chunks. Returns windows with global offsets.
 */
export function buildMicroWindows(
  chunkText: string,
  chunkStartOffset: number,
  chunkEndOffset: number
): { windowText: string; globalStart: number; globalEnd: number }[] {
  if (chunkText.length <= config.CHUNK_WINDOW_THRESHOLD) return [];
  const size = config.MICRO_WINDOW_SIZE;
  const overlap = config.MICRO_WINDOW_OVERLAP;
  const step = size - overlap;
  const windows: { windowText: string; globalStart: number; globalEnd: number }[] = [];
  for (let i = 0; i < chunkText.length; i += step) {
    const end = Math.min(i + size, chunkText.length);
    const windowText = chunkText.slice(i, end);
    const globalStart = chunkStartOffset + i;
    const globalEnd = chunkStartOffset + end;
    windows.push({ windowText, globalStart, globalEnd });
  }
  return windows;
}

/**
 * Enforce PolicyMap atom ids: if model returned an invalid atom_id for the article, set to null and log.
 * Exported for tests.
 */
export function enforceAtomIds(findings: JudgeFinding[]): JudgeFinding[] {
  return findings.map((f) => {
    const aid = f.article_id;
    const atomId = f.atom_id ?? undefined;
    if (atomId == null || atomId === "") return f;
    const norm = normalizeAtomId(atomId, aid);
    const valid = isValidAtomForArticle(aid, norm);
    if (valid) {
      return norm !== atomId ? { ...f, atom_id: norm } : f;
    }
    logger.warn("Judge returned invalid atom_id; clearing", {
      article_id: aid,
      atom_id: atomId,
      normalized: norm,
    });
    return { ...f, atom_id: null };
  });
}

/**
 * Convert Judge location (chunk-relative) to global offsets.
 */
function toGlobalFinding(
  f: JudgeFinding,
  chunkStartOffset: number
): FindingWithGlobal {
  const start_offset_global = chunkStartOffset + (f.location?.start_offset ?? 0);
  const end_offset_global = chunkStartOffset + (f.location?.end_offset ?? 0);
  return {
    ...f,
    start_offset_global,
    end_offset_global,
  };
}

function severityRank(s: string | null | undefined): number {
  const r: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return s ? (r[s] ?? 0) : 0;
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  const left = a ?? Number.POSITIVE_INFINITY;
  const right = b ?? Number.POSITIVE_INFINITY;
  return left - right;
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "ar");
}

function compareFindingsStable(a: FindingWithGlobal, b: FindingWithGlobal): number {
  return (
    compareNullableNumber(a.article_id, b.article_id) ||
    compareNullableText(a.atom_id, b.atom_id) ||
    compareNullableNumber(a.start_offset_global, b.start_offset_global) ||
    compareNullableNumber(a.end_offset_global, b.end_offset_global) ||
    compareNullableText(a.severity, b.severity) ||
    compareNullableNumber(a.confidence, b.confidence) ||
    compareNullableText(a.canonical_atom, b.canonical_atom) ||
    compareNullableText(a.evidence_snippet, b.evidence_snippet) ||
    compareNullableText(a.title_ar, b.title_ar) ||
    compareNullableText(a.description_ar, b.description_ar) ||
    compareNullableText(a.source, b.source) ||
    compareNullableText(a.detection_pass, b.detection_pass) ||
    compareNullableText(a.rationale_ar, b.rationale_ar) ||
    compareNullableText(a.lineage_id, b.lineage_id) ||
    compareNullableText(a.parent_lineage_id, b.parent_lineage_id) ||
    compareNullableText(a.evidence_hash, b.evidence_hash) ||
    compareNullableText(a.canonical_hash, b.canonical_hash)
  );
}

function resolveAnalysisEngineForJob(
  jobConfig: Record<string, unknown>,
  pipelineVersion: "v1" | "v2",
): AnalysisEngineMode {
  return "v2";
}

function compareFindingPreference(a: FindingWithGlobal, b: FindingWithGlobal): number {
  const severityDiff = severityRank(b.severity) - severityRank(a.severity);
  if (severityDiff !== 0) return severityDiff;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if ((a.is_interpretive ? 1 : 0) !== (b.is_interpretive ? 1 : 0)) {
    return (a.is_interpretive ? 1 : 0) - (b.is_interpretive ? 1 : 0);
  }
  const rationaleLenDiff = (b.rationale_ar?.trim().length ?? 0) - (a.rationale_ar?.trim().length ?? 0);
  if (rationaleLenDiff !== 0) return rationaleLenDiff;
  return compareFindingsStable(a, b);
}

function sortFindingsStable(findings: FindingWithGlobal[]): FindingWithGlobal[] {
  return [...findings].sort(compareFindingsStable);
}

function isMemory2Mode(job: AnalysisJob): boolean {
  const mode = (job.config_snapshot as { analysis_memory_mode?: string } | null)?.analysis_memory_mode;
  return String(mode ?? "").toLowerCase() === "memory2";
}

function extractLocalWindow(
  normalizedText: string | null,
  startOffsetGlobal: number | null | undefined,
  endOffsetGlobal: number | null | undefined,
  radius = 220,
): string {
  if (!normalizedText) return "";
  if (typeof startOffsetGlobal !== "number" || typeof endOffsetGlobal !== "number") return "";
  const start = Math.max(0, startOffsetGlobal - radius);
  const end = Math.min(normalizedText.length, endOffsetGlobal + radius);
  if (end <= start) return "";
  return normalizedText.slice(start, end);
}

function hasSchoolOrderContext(text: string): boolean {
  return /(مدرسة|المدرسة|معلم|المعلم|طلاب|الطلاب|فصل|الطابور|أستاذ|ساحة\s+المدرسة|واجب|درجة)/u.test(text);
}

function hasPoliticalGovernanceContext(text: string): boolean {
  return /(نظام\s+الحكم|القيادة\s+السياسية|الحكومة|الدولة|الملك|ولي\s+العهد|انقلاب|انتفاض|إسقاط|قلب\s+نظام)/u.test(text);
}

function hasPoliticalAnchorForClassification(text: string): boolean {
  return /(نظام\s+الحكم|القيادة\s+السياسية|الحكومة|الدولة|الملك|ولي\s+العهد|انقلاب|انتفاض|إسقاط|تمرد|قلب\s+نظام|مؤسسات\s+الحكم|الأمن\s+الوطني)/u.test(text);
}

function hasPoliticalClaimLanguage(text: string): boolean {
  return /(قلب\s+نظام|نظام\s+الحكم|الانتفاض|انتفاض|التمرد|تمرد|إسقاط\s+الحكم|الأمن\s+الوطني|زعزعة\s+النظام|الإعلام\s+الرسمي|أوامر\s+سرية|مؤسسات\s+الحكم|الخروج\s+للشارع)/u.test(
    text,
  );
}

function hasSexualAnchorContext(text: string): boolean {
  return /(جنسي|جنسية|علاقة\s+جنسية|ممارسة\s+جنسية|تحرش|اغتصاب|إيحاء\s+جنسي|عري|مشهد\s+حميمي|فعل\s+فاضح|ألفاظ\s+جنسية)/u.test(
    text,
  );
}

function isPoliticalOrSecurityFinding(f: FindingWithGlobal): boolean {
  const title = String(f.title_ar ?? "");
  const rationale = String(f.rationale_ar ?? "");
  return (
    f.article_id === 2 ||
    f.article_id === 3 ||
    /المساس\s+بالقيادة\s+السياسية|الإضرار\s+بالأمن\s+الوطني|قلب\s+نظام\s+الحكم/u.test(`${title} ${rationale}`)
  );
}

function isSexualFinding(f: FindingWithGlobal): boolean {
  const title = String(f.title_ar ?? "");
  const rationale = String(f.rationale_ar ?? "");
  return (
    f.article_id === 10 ||
    /المشاهد\s+الجنسية\s+الصريحة|محتوى\s+جنسي/u.test(`${title} ${rationale}`)
  );
}

function hasOutOfWindowRationaleClaim(rationale: string, localWindow: string): boolean {
  const exactClaims = [
    "قلب نظام الحكم",
    "الانتفاض",
    "إسقاط الحكم",
    "أوامر سرية",
    "الإعلام الرسمي",
    "الوضع الاقتصادي",
    "مؤسسات الحكم",
    "التمرد ضد النظام",
    "تحريض الناس",
    "إشعال الفوضى",
    "زعزعة النظام العام",
  ];
  const exactDrift = exactClaims.some((claim) => rationale.includes(claim) && !localWindow.includes(claim));
  if (exactDrift) return true;

  // Regex-based drift catches morphology/wording variations.
  const patternDrift = [
    /قلب\s+نظام|إسقاط\s+الحكم|الانتفاض|انتفاض|التمرد|تمرد/u,
    /الإعلام\s+الرسمي|مؤسسات\s+الحكم|أوامر\s+سرية|الوضع\s+الاقتصادي/u,
    /تحريض\s+الناس|إشعال\s+الفوضى|زعزعة\s+النظام/u,
  ].some((re) => re.test(rationale) && !re.test(localWindow));
  return patternDrift;
}

function extractQuotedPhrases(text: string): string[] {
  return [...text.matchAll(/["“”«»]([^"“”«»]{2,120})["“”«»]/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);
}

function hasUngroundedRationaleQuotes(rationale: string, localWindow: string): boolean {
  const quotes = extractQuotedPhrases(rationale);
  if (quotes.length === 0) return false;
  return quotes.some((quote) => !localWindow.includes(quote));
}

function tokenizeArabicRationale(value: string | null | undefined): string[] {
  const text = compactNormalizedEvidence(value);
  if (!text) return [];
  const stopwords = new Set([
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "هنا",
    "هناك",
    "على",
    "عن",
    "إلى",
    "الى",
    "من",
    "في",
    "و",
    "أو",
    "ثم",
    "كما",
    "لأن",
    "لان",
    "قد",
    "تم",
    "يتم",
    "كان",
    "تكون",
    "يكون",
    "ليس",
    "ما",
    "لا",
    "لم",
    "لن",
    "إن",
    "ان",
    "أن",
    "اي",
    "أي",
    "مع",
    "كل",
    "أيضاً",
    "ايضا",
  ]);
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .flatMap((token) => {
      const variants = new Set<string>();
      const normalized = token.normalize("NFC");
      if (normalized.length >= 3 && !stopwords.has(normalized)) variants.add(normalized);
      if (normalized.startsWith("ال") && normalized.length > 4) {
        const stripped = normalized.slice(2);
        if (stripped.length >= 3 && !stopwords.has(stripped)) variants.add(stripped);
      }
      return [...variants];
    });
  return [...new Set(tokens)];
}

export function hasRationaleLocalSupport(rationale: string, localWindow: string): boolean {
  const rationaleTokens = tokenizeArabicRationale(rationale);
  if (rationaleTokens.length === 0) return true;
  const normalizedLocal = compactNormalizedEvidence(localWindow);
  if (!normalizedLocal) return false;
  return rationaleTokens.some((token) => normalizedLocal.includes(token));
}

export function hasDriftProneArticleAnchor(articleId: number, localWindow: string): boolean {
  switch (articleId) {
    case 12:
      return /(?:طفل|الطفل|الطفلة|الطفل\s+يتعرض|أطفال|قاصر|القاصر|يعنف|عنف\s+ضد\s+طفل|ضرب\s+طفل|الاعتداء\s+على\s+طفل)/u.test(localWindow);
    case 15:
      return /(?:فوضى|الفوضى|شغب|الشغب|اضطراب|اضطرابات|تحريض|يحرض|إخلال\s+بالنظام|النظام\s+العام|صراخ|تجمهر|اشتباك)/u.test(localWindow);
    case 19:
      return /(?:اقتصاد|الاقتصاد|اقتصادي|الاقتصادي|أسعار|السوق|مالية|المالية|عملة|البنك|التضخم|الديون|تجارة)/u.test(localWindow);
    case 21:
      return /(?:وثيقة|الوثيقة|مستند|ملف|الملف|تسريب|مسرب|مسربة|سري|سرية|معلومات\s+سرية|وثائق)/u.test(localWindow);
    case 23:
      return /(?:عري|عريان|مكشوف|ملابس|الملابس|لباس|لبس|زي|حجاب|قميص|سروال|فستان|جسد|المظهر|الهيئة)/u.test(localWindow);
    default:
      return true;
  }
}

type Memory2GuardRejection = {
  reason:
    | "missing_political_anchor"
    | "school_context_not_governance"
    | "school_system_word_not_governance"
    | "ungrounded_political_rationale"
    | "missing_sexual_anchor"
    | "unsupported_rationale"
    | "ownership_drift"
    | "rationale_local_mismatch";
  article: number;
  title: string | null | undefined;
  evidence: string;
  rationale: string;
};

export function applyMemory2SanityGuards(
  findings: FindingWithGlobal[],
  normalizedText: string | null,
  chunkText: string,
  auditMode = false,
): { accepted: FindingWithGlobal[]; rejected: Memory2GuardRejection[] } {
  const guarded: FindingWithGlobal[] = [];
  const rejected: Memory2GuardRejection[] = [];
  for (const finding of findings) {
    const localWindow = extractLocalWindow(
      normalizedText,
      finding.start_offset_global ?? null,
      finding.end_offset_global ?? null,
    );
    const combinedLocal = `${localWindow}\n${chunkText}\n${finding.evidence_snippet ?? ""}`;
    const rationale = String(finding.rationale_ar ?? "");

    // For political/security classes, require explicit governance anchors in the local context.
    // This blocks category-first hallucinations in school/discipline scenes.
    if (
      isPoliticalOrSecurityFinding(finding) &&
      !hasPoliticalAnchorForClassification(combinedLocal)
    ) {
      rejected.push({
        reason: "missing_political_anchor",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: political/security finding without governance anchors", {
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    // Extra hard fence: school-order context with no governance anchors cannot be political/security.
    if (
      isPoliticalOrSecurityFinding(finding) &&
      hasSchoolOrderContext(combinedLocal) &&
      !hasPoliticalGovernanceContext(combinedLocal)
    ) {
      rejected.push({
        reason: "school_context_not_governance",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: political/security finding in school context", {
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    if (
      isPoliticalOrSecurityFinding(finding) &&
      /النظام/u.test(combinedLocal) &&
      hasSchoolOrderContext(combinedLocal) &&
      !hasPoliticalGovernanceContext(combinedLocal)
    ) {
      rejected.push({
        reason: "school_system_word_not_governance",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: political/security finding due to school-order context", {
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    // Any political/security rationale language must be present in local context.
    if (
      hasPoliticalClaimLanguage(rationale) &&
      !hasPoliticalAnchorForClassification(combinedLocal)
    ) {
      rejected.push({
        reason: "ungrounded_political_rationale",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: finding due to ungrounded political/security rationale", {
        article: finding.article_id,
        title: finding.title_ar,
        rationale: rationale.slice(0, 180),
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    if (rationale && !hasRationaleLocalSupport(rationale, combinedLocal)) {
      rejected.push({
        reason: "unsupported_rationale",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: finding due to unsupported local rationale", {
        article: finding.article_id,
        title: finding.title_ar,
        rationale: rationale.slice(0, 180),
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    // Sexual category must be grounded by explicit sexual anchors in local context.
    // This blocks child-abuse or bullying snippets from leaking into article 10.
    if (isSexualFinding(finding) && !hasSexualAnchorContext(combinedLocal)) {
      rejected.push({
        reason: "missing_sexual_anchor",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: sexual finding without sexual anchors", {
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    if (
      finding.article_id != null &&
      [12, 15, 19, 21, 23].includes(finding.article_id) &&
      !hasDriftProneArticleAnchor(finding.article_id, combinedLocal)
    ) {
      rejected.push({
        reason: "ownership_drift",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: drift-prone finding without article anchor", {
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    if (rationale && hasOutOfWindowRationaleClaim(rationale, combinedLocal)) {
      rejected.push({
        reason: "rationale_local_mismatch",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: finding due to rationale/local-window mismatch", {
        article: finding.article_id,
        title: finding.title_ar,
        rationale: rationale.slice(0, 180),
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    if (rationale && hasUngroundedRationaleQuotes(rationale, combinedLocal)) {
      rejected.push({
        reason: "rationale_local_mismatch",
        article: finding.article_id,
        title: finding.title_ar,
        evidence: (finding.evidence_snippet ?? "").slice(0, 220),
        rationale: rationale.slice(0, 260),
      });
      logger.warn("Memory2 sanity guard advisory: finding due to ungrounded rationale quote", {
        article: finding.article_id,
        title: finding.title_ar,
        rationale: rationale.slice(0, 180),
        evidence: (finding.evidence_snippet ?? "").slice(0, 120),
      });
      guarded.push(finding);
      continue;
    }

    guarded.push(finding);
  }
  return { accepted: guarded, rejected };
}

async function persistMemory2SanityTrace(args: {
  job: AnalysisJob;
  chunk: AnalysisChunk;
  beforeCount: number;
  acceptedCount: number;
  rejected: Memory2GuardRejection[];
}): Promise<void> {
  if (!isMemory2Mode(args.job)) return;
  const rejectedByReason = args.rejected.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});

  const traceRow = {
    job_id: args.job.id,
    script_id: args.job.script_id,
    version_id: args.job.version_id,
    chunk_id: args.chunk.id,
    chunk_index: args.chunk.chunk_index,
    pass_name: "memory2_sanity_guard",
    memory_version: PIPELINE_V2_MEMORY_VERSION,
    trace_payload: {
      before_count: args.beforeCount,
      accepted_count: args.acceptedCount,
      dropped_count: args.rejected.length,
      rejected_by_reason: rejectedByReason,
      rejected_samples: args.rejected.slice(0, 8),
    },
  };

  const { error } = await supabase
    .from("analysis_memory_traces")
    .upsert(traceRow, { onConflict: "job_id,chunk_id,pass_name" });

  if (error) {
    logger.warn("Memory2 sanity trace upsert failed", {
      jobId: args.job.id,
      chunkId: args.chunk.id,
      error: error.message,
    });
    return;
  }
  logger.info("Memory2 sanity trace upsert succeeded", {
    jobId: args.job.id,
    chunkId: args.chunk.id,
    dropped: args.rejected.length,
    accepted: args.acceptedCount,
  });
}

function compactNormalizedEvidence(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function tokenizeEvidence(value: string | null | undefined): string[] {
  return compactNormalizedEvidence(value).split(/\s+/).filter(Boolean);
}

function isWordLikeChar(char: string | undefined): boolean {
  return typeof char === "string" && /[\p{L}\p{N}]/u.test(char);
}

function isHeadingLikeEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return (
    /^(?:المشهد|مشهد)\s*[\d\u0660-\u0669]+/u.test(text) ||
    (/^(?:داخلي|خارجي)\b/u.test(text) && text.length > 12) ||
    (/[\u0600-\u06FF]/u.test(text) && /(داخلي|خارجي)/u.test(text) && text.length > 24)
  );
}

function hasWomenSpecificEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return (
    /(امرأ|المرأة|نساء|زوجة|زوجتك|بنت|البنت|بنات|أنثى|مطبخ|السرير|البيت)/u.test(text) ||
    /(ما\s+لك\s+كلمة|مالك\s+كلمة|ما\s+لها\s+كلمة|مكانك\s+المطبخ|مكان\s+البنت|مكانها\s+البيت|للمطبخ\s+والسرير|للمطبخ|السرير\s+وبس)/u.test(text)
  );
}

function hasViolenceKeywordEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return /(ضرب|أضرب|بضرب|يضر|قتل|أقتل|بقتل|ذبح|طعن|ركل|صفع|دفع|عنف|يعنف|يعنفني|يضربني|بقتلك|جزمة|عصا|مسدس|سكين|دم)/u.test(text);
}

function getSceneContextAtOffset(sceneIndex: SceneIndexEntry[], fullText: string | null, offset: number | null | undefined): string {
  if (!fullText || !sceneIndex.length || typeof offset !== "number" || offset < 0) return "";
  const scene = sceneIndex.find((entry) => offset >= entry.startOffset && offset < entry.endOffset);
  if (!scene) return "";
  return fullText.slice(scene.startOffset, scene.endOffset);
}

export function getPassSpecificEvidenceIssue(
  finding: FindingWithGlobal,
  excerpt: string,
  fullText?: string | null,
  sceneIndex: SceneIndexEntry[] = [],
): string | null {
  const pass = String(finding.detection_pass ?? "").trim().toLowerCase();
  const atom = String(finding.canonical_atom ?? "").trim().toUpperCase();
  const articleId = finding.article_id ?? 0;
  const source = String(finding.source ?? "ai").trim().toLowerCase();
  const rationale = String(finding.rationale_ar ?? "");
  if (source === "lexicon_mandatory" || source === "manual") return null;

  if (pass.startsWith("v3_")) {
    const subject = V3_SUBJECT_DEFINITIONS.find((item) => item.name.toLowerCase() === pass);
    if (subject && !subject.articleIds.includes(articleId)) {
      return "pass_article_mismatch";
    }
  }

  const sceneContext = getSceneContextAtOffset(sceneIndex, fullText ?? null, finding.start_offset_global ?? null);
  const localContext = `${sceneContext}\n${excerpt}`;

  if (rationale && !hasRationaleLocalSupport(rationale, localContext)) {
    return "unsupported_rationale";
  }

  if ([12, 15, 19, 21, 23].includes(articleId) && !hasDriftProneArticleAnchor(articleId, localContext)) {
    return "ownership_drift";
  }

  if ((pass === "women" || articleId === 7 || atom === "WOMEN") && !hasWomenSpecificEvidence(localContext)) {
    return "women_not_self_proving";
  }

  if (
    (pass === "v3_03_national_security" || pass === "national_security" || articleId === 3 || atom === "NATIONAL_SECURITY") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "security_not_self_proving";
  }

  if (
    (pass === "v3_02_political_leadership" || pass === "political_leadership" || articleId === 2 || atom === "POLITICAL_LEADERSHIP") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "political_not_self_proving";
  }

  if (
    (pass === "v3_10_explicit_sex" || articleId === 10 || atom === "EXPLICIT_SEX") &&
    !hasSexualAnchorContext(localContext)
  ) {
    return "sexual_not_self_proving";
  }

  const tokenCount = tokenizeEvidence(excerpt).length;
  if ((pass === "violence" || articleId === 9 || atom === "VIOLENCE") && tokenCount === 1 && !hasViolenceKeywordEvidence(excerpt)) {
    return "violence_single_word_non_violent";
  }

  return null;
}

function getEvidenceQualityIssue(finding: JudgeFinding, chunkText: string): string | null {
  const evidence = typeof finding.evidence_snippet === "string" ? finding.evidence_snippet : "";
  if (evidence.trim().length === 0) return "empty";
  if (!/[\p{L}]/u.test(evidence)) return "non_text";
  if (evidence.length < 2) return "too_short";

  const start = finding.location?.start_offset ?? null;
  const end = finding.location?.end_offset ?? null;
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end > start &&
    end <= chunkText.length
  ) {
    const span = chunkText.slice(start, end);
    if (span !== evidence) return "evidence_mismatch";
    return null;
  }

  return "missing_offsets";
}

function getStoredEvidenceQualityIssue(
  evidenceSnippet: string | null | undefined,
  fullText: string | null,
  startOffsetGlobal: number | null | undefined,
  endOffsetGlobal: number | null | undefined,
): string | null {
  const evidence = typeof evidenceSnippet === "string" ? evidenceSnippet : "";
  if (evidence.trim().length === 0) return "empty";
  if (!/[\p{L}]/u.test(evidence)) return "non_text";
  if (evidence.length < 2) return "too_short";
  if (isHeadingLikeEvidence(evidence)) return "heading_like";

  if (
    typeof fullText === "string" &&
    typeof startOffsetGlobal === "number" &&
    typeof endOffsetGlobal === "number" &&
    startOffsetGlobal >= 0 &&
    endOffsetGlobal > startOffsetGlobal &&
    endOffsetGlobal <= fullText.length
  ) {
    const span = fullText.slice(startOffsetGlobal, endOffsetGlobal);
    if (span !== evidence) return "evidence_mismatch";
    return null;
  }

  return "missing_offsets";
}

function normalizeEvidenceSpanToWordBoundaries(
  fullText: string | null,
  startOffsetGlobal: number | null | undefined,
  endOffsetGlobal: number | null | undefined,
): { start: number; end: number; excerpt: string } | null {
  if (
    typeof fullText !== "string" ||
    typeof startOffsetGlobal !== "number" ||
    typeof endOffsetGlobal !== "number" ||
    startOffsetGlobal < 0 ||
    endOffsetGlobal <= startOffsetGlobal ||
    endOffsetGlobal > fullText.length
  ) {
    return null;
  }

  let start = startOffsetGlobal;
  let end = endOffsetGlobal;
  const maxExpansion = 24;
  const originalStart = start;
  const originalEnd = end;

  while (
    start > 0 &&
    (originalStart - start) < maxExpansion &&
    isWordLikeChar(fullText[start - 1]) &&
    isWordLikeChar(fullText[start])
  ) {
    start--;
  }

  while (
    end < fullText.length &&
    (end - originalEnd) < maxExpansion &&
    isWordLikeChar(fullText[end - 1]) &&
    isWordLikeChar(fullText[end])
  ) {
    end++;
  }

  if (end <= start || (end - start) > MAX_EVIDENCE_SPAN) return null;
  return {
    start,
    end,
    excerpt: compactEvidenceText(fullText.slice(start, end)),
  };
}

function normalizeEvidenceCompareText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\s"'“”«»„:;,.!?()\[\]{}\-–—_]+/gu, " ")
    .trim()
    .toLowerCase();
}

function snippetsReasonablyAlign(modelSnippet: string, canonicalSnippet: string): boolean {
  const model = normalizeEvidenceCompareText(modelSnippet);
  const canonical = normalizeEvidenceCompareText(canonicalSnippet);
  if (!model || !canonical) return true;
  if (model === canonical) return true;
  if (model.includes(canonical) || canonical.includes(model)) return true;

  const modelTokens = model.split(/\s+/).filter((token) => token.length >= 2);
  const canonicalTokens = canonical.split(/\s+/).filter((token) => token.length >= 2);
  if (modelTokens.length === 0 || canonicalTokens.length === 0) return false;

  const canonicalSet = new Set(canonicalTokens);
  const overlap = modelTokens.filter((token) => canonicalSet.has(token)).length;
  const minTokenCount = Math.min(modelTokens.length, canonicalTokens.length);
  if (minTokenCount <= 2) return false;
  return overlap / minTokenCount >= 0.6;
}

type SceneIndexEntry = {
  sceneIndex: number;
  startOffset: number;
  endOffset: number;
};

function normalizeSceneDigits(value: string): string {
  return value.replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function buildSceneIndex(fullText: string | null): SceneIndexEntry[] {
  if (!fullText) return [];
  const matches = [...fullText.matchAll(/^(.*)$/gmu)];
  const headings = matches
    .map((match) => ({
      heading: (match[1] ?? "").replace(/\s+/g, " ").trim(),
      startOffset: match.index ?? 0,
    }))
    .filter((line) => {
      const heading = line.heading;
      if (!heading) return false;
      return (
        /^(?:المشهد|مشهد)\s*[\d\u0660-\u0669]+/u.test(heading) ||
        /^(?:[.٠-٩0-9]+\s+)?(?:المشهد|مشهد|الفصل|الطريق|منزل|سيارة)\b/u.test(heading) ||
        /^(?:داخلي|خارجي)\b/u.test(heading)
      );
    });

  return headings.map((heading, index) => ({
    sceneIndex: index + 1,
    startOffset: heading.startOffset,
    endOffset: headings[index + 1]?.startOffset ?? fullText.length,
  }));
}

function resolveSceneIndexAtOffset(sceneIndex: SceneIndexEntry[], offset: number | null | undefined): number | null {
  if (!sceneIndex.length || typeof offset !== "number" || offset < 0) return null;
  return (
    sceneIndex.find((scene) => offset >= scene.startOffset && offset < scene.endOffset)?.sceneIndex ??
    sceneIndex[sceneIndex.length - 1]?.sceneIndex ??
    null
  );
}

function extractSceneNumbersFromRationale(value: string | null | undefined): number[] {
  const text = normalizeSceneDigits(value ?? "");
  if (!text) return [];
  return [...text.matchAll(/(?:المشهد|مشهد|scene)\s+(\d+)/giu)]
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((num) => Number.isFinite(num));
}

function hasExplicitSceneMismatch(
  rationale: string | null | undefined,
  sceneIndex: SceneIndexEntry[],
  startOffsetGlobal: number | null | undefined,
): boolean {
  const mentioned = extractSceneNumbersFromRationale(rationale);
  if (mentioned.length === 0) return false;
  const resolved = resolveSceneIndexAtOffset(sceneIndex, startOffsetGlobal);
  if (!resolved) return false;
  return !mentioned.includes(resolved);
}

function isWeakArticleFourEvidence(candidate: FindingWithGlobal): boolean {
  const evidence = compactNormalizedEvidence(candidate.evidence_snippet);
  if (!evidence) return true;
  if (isHeadingLikeEvidence(evidence)) return true;
  if (evidence.length < 8 && /\s/.test(evidence)) return true;
  return false;
}

const ARTICLE_FOUR_DEFER_PASS_NAMES = new Set([
  "insults",
  "violence",
  "women",
  "discrimination_incitement",
  "misinformation",
]);

function detectionPassNameOf(finding: FindingWithGlobal): string {
  return String(finding.detection_pass ?? "").trim().toLowerCase();
}

function isArticleFourDeferredBySpecificPass(
  candidate: FindingWithGlobal,
  specific: FindingWithGlobal[],
): boolean {
  return specific.some((other) => {
    const otherPass = detectionPassNameOf(other);
    if (!ARTICLE_FOUR_DEFER_PASS_NAMES.has(otherPass)) return false;

    const candidateEvidence = compactNormalizedEvidence(candidate.evidence_snippet);
    const otherEvidence = compactNormalizedEvidence(other.evidence_snippet);
    const sameEvidence =
      candidateEvidence.length >= 3 &&
      otherEvidence.length >= 3 &&
      (candidateEvidence.includes(otherEvidence) || otherEvidence.includes(candidateEvidence));
    const sameIncident = sameEvidence || spansOverlapEnough(candidate, other) || incidentsAreNearby(candidate, other, 280);
    if (!sameIncident) return false;

    const strongerSpecific =
      severityRank(other.severity) > severityRank(candidate.severity) ||
      (severityRank(other.severity) === severityRank(candidate.severity) &&
        (other.confidence ?? 0) >= (candidate.confidence ?? 0));

    return strongerSpecific || !isWeakArticleFourEvidence(other);
  });
}

function incidentsAreNearby(a: FindingWithGlobal, b: FindingWithGlobal, maxDistance = 1200): boolean {
  const aStart = a.start_offset_global ?? 0;
  const aEnd = a.end_offset_global ?? aStart;
  const bStart = b.start_offset_global ?? 0;
  const bEnd = b.end_offset_global ?? bStart;
  const distance = Math.min(
    Math.abs(aStart - bStart),
    Math.abs(aStart - bEnd),
    Math.abs(aEnd - bStart),
    Math.abs(aEnd - bEnd),
  );
  return distance <= maxDistance;
}

function spansOverlapEnough(a: FindingWithGlobal, b: FindingWithGlobal, minRatio = 0.6): boolean {
  const aStart = a.start_offset_global ?? 0;
  const aEnd = a.end_offset_global ?? aStart;
  const bStart = b.start_offset_global ?? 0;
  const bEnd = b.end_offset_global ?? bStart;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const aLen = Math.max(0, aEnd - aStart);
  const bLen = Math.max(0, bEnd - bStart);
  if (aLen === 0 || bLen === 0) return false;
  return overlap / Math.min(aLen, bLen) >= minRatio;
}

function dropRedundantArticleFourFindings(findings: FindingWithGlobal[]): FindingWithGlobal[] {
  const specific = findings.filter((f) => (f.article_id ?? 0) !== 4);
  if (specific.length === 0) return findings;

  return findings.filter((candidate) => {
    if ((candidate.article_id ?? 0) !== 4) return true;
    if (String(candidate.source ?? "ai").toLowerCase() === "lexicon_mandatory") return true;

    const candidateEvidence = compactNormalizedEvidence(candidate.evidence_snippet);
    const candidateAtom = String(candidate.canonical_atom ?? "").toUpperCase();
    const duplicateOwner = specific.some((other) => {
      const otherEvidence = compactNormalizedEvidence(other.evidence_snippet);
      const sameEvidence =
        candidateEvidence.length >= 3 &&
        otherEvidence.length >= 3 &&
        (candidateEvidence.includes(otherEvidence) || otherEvidence.includes(candidateEvidence));
      const sameIncident = sameEvidence || spansOverlapEnough(candidate, other);
      if (!sameIncident) return false;
      if (candidateAtom && String(other.canonical_atom ?? "").toUpperCase() !== candidateAtom) return false;
      return severityRank(other.severity) >= severityRank(candidate.severity);
    });
    if (duplicateOwner) return false;

    if (isWeakArticleFourEvidence(candidate)) {
      const nearbySpecificOwner = specific.some((other) => {
        if (!incidentsAreNearby(candidate, other)) return false;
        return severityRank(other.severity) >= severityRank(candidate.severity);
      });
      if (nearbySpecificOwner) return false;
    }

    if (isArticleFourDeferredBySpecificPass(candidate, specific)) {
      return false;
    }

    return true;
  });
}

function articleListsAreEquivalent(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

function computeContradictionMetrics(findings: FindingWithGlobal[]): {
  contradictionGroups: number;
  severeDisagreementGroups: number;
} {
  const byEvidence = new Map<string, Set<string>>();
  for (const f of findings) {
    const key = `${f.article_id}|${f.start_offset_global}|${f.end_offset_global}|${(f.evidence_snippet || "").slice(0, 80)}`;
    if (!byEvidence.has(key)) byEvidence.set(key, new Set());
    byEvidence.get(key)!.add(f.severity ?? "medium");
  }
  let contradictionGroups = 0;
  let severeDisagreementGroups = 0;
  for (const sevSet of byEvidence.values()) {
    if (sevSet.size > 1) {
      contradictionGroups++;
      if (sevSet.has("critical") && (sevSet.has("low") || sevSet.has("medium"))) severeDisagreementGroups++;
    }
  }
  return { contradictionGroups, severeDisagreementGroups };
}

/**
 * Dedupe by evidence_hash; keep one per hash (prefer higher severity, then confidence, then non-interpretive).
 */
export function dedupeByHash(findings: FindingWithGlobal[]): FindingWithGlobal[] {
  const byHash = new Map<string, FindingWithGlobal>();
  for (const f of findings) {
    const h = evidenceHash(
      f.article_id,
      f.atom_id ?? null,
      f.start_offset_global,
      f.end_offset_global,
      f.evidence_snippet
    );
    const existing = byHash.get(h);
    if (!existing) {
      byHash.set(h, f);
      continue;
    }
    const better = compareFindingPreference(f, existing) < 0;
    if (better) byHash.set(h, f);
  }
  return sortFindingsStable([...byHash.values()]);
}

/**
 * Overlap > 70% for same article_id+atom_id: keep stronger (severity > confidence > non-interpretive).
 */
export function overlapCollapse(findings: FindingWithGlobal[]): FindingWithGlobal[] {
  const key = (f: FindingWithGlobal) => `${f.article_id}:${f.atom_id ?? ""}`;
  const groups = new Map<string, FindingWithGlobal[]>();
  for (const f of findings) {
    const k = key(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const result: FindingWithGlobal[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      return compareFindingPreference(a, b);
    });
    const kept: FindingWithGlobal[] = [];
    for (const f of list) {
      const overlapRatio = (s: number, e: number) => {
        const isectStart = Math.max(s, f.start_offset_global);
        const isectEnd = Math.min(e, f.end_offset_global);
        const isect = Math.max(0, isectEnd - isectStart);
        const len = f.end_offset_global - f.start_offset_global;
        return len > 0 ? isect / len : 0;
      };
      const overlaps = kept.some(
        (k) =>
          overlapRatio(k.start_offset_global, k.end_offset_global) > config.OVERLAP_COLLAPSE_RATIO
      );
      if (!overlaps) kept.push(f);
    }
    result.push(...kept);
  }
  return sortFindingsStable(result);
}

/**
 * Process a single chunk: lexicon -> router -> judge -> verbatim -> micro-windows -> dedupe -> overlap -> insert.
 * normalizedText: full canonical text for this job; used to derive evidence_snippet from global offsets so excerpt matches canonical.
 */
export async function processChunkJudge(
  job: AnalysisJob,
  chunk: AnalysisChunk,
  normalizedText: string | null,
  signal?: AbortSignal
): Promise<void> {
  const chunkStartedAt = Date.now();
  const { id: jobId, script_id: scriptId, version_id: versionId } = job;
  const jobConfig = (job.config_snapshot as any) || {};
  const analysisProfile =
    jobConfig.analysis_profile === "quality" || jobConfig.analysis_profile === "turbo" || jobConfig.analysis_profile === "balanced"
      ? jobConfig.analysis_profile
      : "balanced";
  const pipelineVersion = jobConfig.pipeline_version === "v2" ? "v2" : "v1";
  const analysisEngine = resolveAnalysisEngineForJob(jobConfig, pipelineVersion);
  const chunkText = chunk.text;
  const chunkStart = chunk.start_offset;
  const chunkEnd = chunk.end_offset;
  const validatorAuditMode = config.VALIDATOR_AUDIT_MODE || config.VALIDATOR_DEBUG_MODE;
  const validatorAdvisoryIssues = new Set([
    "event_not_supported",
    "event_evidence_mismatch",
    "event_rationale_mismatch",
    "event_span_mismatch",
    "event_ambiguous",
    "unsupported_rationale",
    "ownership_drift",
    "non_text",
    "too_short",
    "heading_like",
    "women_not_self_proving",
    "security_not_self_proving",
    "political_not_self_proving",
    "sexual_not_self_proving",
    "violence_single_word_non_violent",
    "evidence_mismatch",
    "rationale_local_mismatch",
    "pass_article_mismatch",
    "canonical_model_mismatch",
    "explicit_scene_mismatch",
    "strict_exact_proof_required",
  ]);
  const objectiveEvidenceIssues = new Set(["empty", "missing_offsets"]);
  const isValidatorAdvisoryIssue = (issue: string | null | undefined): boolean =>
    typeof issue === "string" && validatorAdvisoryIssues.has(issue);
  const validatorWarnings: Array<{
    stage: string;
    issue: string;
    articleId: number | null;
    passName: string | null;
    message: string;
  }> = [];
  const validatorRejectionCounts = new Map<string, number>();

  const recordValidatorRejection = (rule: string): void => {
    validatorRejectionCounts.set(rule, (validatorRejectionCounts.get(rule) ?? 0) + 1);
  };

  throwIfAborted(signal);
  if (await isJobCancelled(jobId)) {
    await setChunkFailed(chunk.id, "Cancelled by user");
    throw new JobCancelledError();
  }

  if (!chunkText?.trim()) {
    await setChunkDone(chunk.id);
    await incrementJobProgress(jobId);
    return;
  }

  logger.info("[DEBUG] processChunkJudge started", {
    jobId,
    chunkId: chunk.id,
    chunkTextLength: chunkText.length,
    chunkStart,
    chunkEnd,
    ALWAYS_CHECK_ARTICLES_count: ALWAYS_CHECK_ARTICLES.length,
    ALWAYS_CHECK_ARTICLES_ids: [...ALWAYS_CHECK_ARTICLES],
  });

  const jobResourcesStartedAt = Date.now();
  const { pageRows, promptLexiconTerms } = await getCachedJobResources(supabase, jobId, versionId);
  throwIfAborted(signal);
  const jobResourcesDurationMs = Date.now() - jobResourcesStartedAt;
  const pageNumAt = (off: number) =>
    pageRows.length > 0 ? offsetToPageNumber(off, pageRows) : null;
  
  const terms = promptLexiconTerms;
  const { router: routerPrompt, judge: judgePrompt } = injectLexiconIntoPrompts(
    ROUTER_SYSTEM_MSG,
    JUDGE_SYSTEM_MSG,
    terms
  );
  
  logger.info("Lexicon terms injected into prompts", { 
    jobId, 
    chunkId: chunk.id, 
    termsCount: terms.length,
    sampleTerms: terms.slice(0, 3).map(t => t.term)
  });

  // 1) Lexicon mandatory findings (global offsets = chunk start + match range in chunk)
  // evidence_snippet from canonical slice so it matches viewer content; optional context in location for debugging
  const isDev = process.env.NODE_ENV !== "production";
  let lexiconMismatchLogCount = 0;
  const LEXICON_MISMATCH_LOG_CAP = 3;
  const CONTEXT_CHARS = 20;

  // HEALTH CHECK: warn if lexicon cache appears empty
  const lexiconCache = getLexiconCache(supabase);
  const lexiconCount = lexiconCache.getCount();
  if (lexiconCount === 0) {
    logger.warn("Lexicon cache empty for chunk", { jobId, chunkId: chunk.id, lexiconCount: 0 });
  }
  if (isDev) logger.info("Lexicon cache health check", { chunkId: chunk.id, lexiconCount, cacheStatus: "checked" });

  const { mandatoryFindings } = analyzeLexiconMatches(chunkText, supabase);
  for (const m of mandatoryFindings) {
    const hash = lexiconEvidenceHash(jobId, m.articleId, m.term.term, m.line_start);
    const startGlobal = chunkStart + m.match.startIndex;
    const endGlobal = chunkStart + m.match.endIndex;
    const matchText = m.match.matchedText;

    // Evidence snippet from canonical when available so offsets align with viewer
    let evidence_snippet: string;
    let location: Record<string, unknown> = {};
    if (normalizedText != null && startGlobal >= 0 && endGlobal <= normalizedText.length) {
      evidence_snippet = normalizedText.slice(startGlobal, endGlobal);
      location = {
        context_before: startGlobal > 0 ? normalizedText.slice(Math.max(0, startGlobal - CONTEXT_CHARS), startGlobal) : "",
        context_after: endGlobal < normalizedText.length ? normalizedText.slice(endGlobal, Math.min(normalizedText.length, endGlobal + CONTEXT_CHARS)) : "",
      };
      // DEV: assert canonical slice equals matched substring (or normalized-equal); log first N mismatches
      if (isDev) {
        const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
        const sliceNorm = norm(evidence_snippet);
        const matchNorm = norm(matchText);
        const equal = evidence_snippet === matchText || sliceNorm === matchNorm;
        if (!equal && lexiconMismatchLogCount < LEXICON_MISMATCH_LOG_CAP) {
          lexiconMismatchLogCount++;
          logger.warn("Lexicon offset mismatch", {
            term: m.term.term,
            term_type: m.term.term_type,
            matchText: matchText.slice(0, 80),
            slicePreview: evidence_snippet.slice(0, 80),
            chunkStart,
            localStart: m.match.startIndex,
            localEnd: m.match.endIndex,
            startGlobal,
            endGlobal,
          });
        }
      }
    } else {
      evidence_snippet = m.evidence_snippet;
    }
    const rationaleAr = buildLexiconMandatoryRationale({
      term: m.term.term,
      evidence: evidence_snippet,
      articleId: m.articleId,
      atomId: m.atomId,
      articleTitleAr: m.term.gcam_article_title_ar ?? null,
    });

    const lexPageNumber = pageNumAt(startGlobal);
      const lexRow = {
        job_id: jobId,
        script_id: scriptId,
        version_id: versionId,
        source: "lexicon_mandatory",
        finding_uuid: buildFindingUuid({
          kind: "lexicon_mandatory",
          job_id: jobId,
          chunk_id: chunk.id,
          article_id: m.articleId,
          atom_id: m.atomId,
          term: m.term.term,
          evidence_snippet,
          start_offset_global: startGlobal,
          end_offset_global: endGlobal,
          line_start: m.line_start,
          line_end: m.line_end,
        }),
        article_id: m.articleId,
        atom_id: m.atomId,
        severity: m.severity,
      confidence: 1,
      title_ar: `مخالفة من قاموس المصطلحات: ${m.term.term}`,
      description_ar: evidence_snippet,
      rationale_ar: rationaleAr,
      evidence_snippet,
      start_offset_global: startGlobal,
      end_offset_global: endGlobal,
      start_line_chunk: m.line_start,
      end_line_chunk: m.line_end,
      location,
      evidence_hash: hash,
      canonical_atom: getPrimaryCanonicalAtomForGcam(m.articleId, m.atomId) ?? null,
      page_number: lexPageNumber,
      ...(() => {
        const pl = computePageLocalSpan(startGlobal, endGlobal, pageRows);
        return {
          start_offset_page: pl.start_offset_page,
          end_offset_page: pl.end_offset_page,
        };
      })(),
      ...buildCanonicalAnchorPayload({
        startGlobal,
        endGlobal,
        pageNumber: lexPageNumber,
        pageRows,
        anchorText: evidence_snippet,
        documentContent: normalizedText,
      }),
    };
    const { data: lexData, error: lexErr } = await supabase
      .from("analysis_findings")
      .upsert(lexRow, { onConflict: "job_id,evidence_hash", ignoreDuplicates: true })
      .select("id,article_id,atom_id,confidence");
    logger.info("Lexicon finding upsert result", {
      jobId, chunkId: chunk.id, hash,
      inserted: lexData?.length ?? 0,
      error: lexErr ?? null,
      rowKeys: Object.keys(lexRow),
    });
    if (lexErr) {
      logger.error("Lexicon finding upsert FAILED", { jobId, chunkId: chunk.id, error: lexErr });
    } else {
      await upsertFindingPolicyLinks(
        (lexData ?? []).map((r: { id: string; article_id: number; atom_id: string | null; confidence?: number | null }) => ({
          id: (r as { id: string }).id,
          article_id: (r as { article_id: number }).article_id,
          atom_id: (r as { atom_id: string | null }).atom_id,
          confidence: (r as { confidence?: number | null }).confidence ?? 1,
        }))
      );
    }
  }

  // 1a) Tiny hard fallback for critical direct insults (deterministic match; independent from model output).
  let hardFallbackInserted = 0;
  for (const rule of HARD_FALLBACK_INSULTS) {
    const hardMatches = findStringMatches(chunkText, rule.term, "word");
    for (const hardMatch of hardMatches) {
      const startLocal = hardMatch.startIndex;
      const endLocal = hardMatch.endIndex;
      const startGlobal = chunkStart + startLocal;
      const endGlobal = chunkStart + endLocal;
      const line = getLineNumberAt(chunkText, startLocal);
      const hash = lexiconEvidenceHash(jobId, rule.articleId, rule.term, line);
      const evidence =
        normalizedText != null && startGlobal >= 0 && endGlobal <= normalizedText.length
          ? normalizedText.slice(startGlobal, endGlobal)
          : rule.term;
      const rationaleAr = buildDirectInsultRationale({
        term: rule.term,
        evidence,
        articleId: rule.articleId,
        atomId: rule.atomId,
      });

      const fallbackPageNumber = pageNumAt(startGlobal);
      const fallbackRow = {
        job_id: jobId,
        script_id: scriptId,
        version_id: versionId,
        source: "lexicon_mandatory",
        finding_uuid: buildFindingUuid({
          kind: "hard_fallback_insult",
          job_id: jobId,
          chunk_id: chunk.id,
          article_id: rule.articleId,
          atom_id: rule.atomId,
          term: rule.term,
          start_offset_global: startGlobal,
          end_offset_global: endGlobal,
          line_start: line,
        }),
        article_id: rule.articleId,
        atom_id: rule.atomId,
        severity: rule.severity,
        confidence: 1,
        title_ar: `مخالفة إساءة مباشرة: ${rule.term}`,
        description_ar: evidence,
        rationale_ar: rationaleAr,
        evidence_snippet: evidence,
        start_offset_global: startGlobal,
        end_offset_global: endGlobal,
        start_line_chunk: line,
        canonical_atom: getPrimaryCanonicalAtomForGcam(rule.articleId, rule.atomId) ?? null,
        end_line_chunk: line,
        location: {},
        evidence_hash: hash,
        page_number: fallbackPageNumber,
        ...(() => {
          const pl = computePageLocalSpan(startGlobal, endGlobal, pageRows);
          return {
            start_offset_page: pl.start_offset_page,
            end_offset_page: pl.end_offset_page,
          };
        })(),
        ...buildCanonicalAnchorPayload({
          startGlobal,
          endGlobal,
          pageNumber: fallbackPageNumber,
          pageRows,
          anchorText: evidence,
          documentContent: normalizedText,
        }),
      };

      const { data: fbData, error: fbErr } = await supabase
        .from("analysis_findings")
        .upsert(fallbackRow, { onConflict: "job_id,evidence_hash", ignoreDuplicates: true })
        .select("id,article_id,atom_id,confidence");
      if (fbErr) {
        logger.error("Hard fallback insult upsert FAILED", { jobId, chunkId: chunk.id, term: rule.term, error: fbErr });
      } else {
        hardFallbackInserted += fbData?.length ?? 0;
        await upsertFindingPolicyLinks(
        (fbData ?? []).map((r: { id: string; article_id: number; atom_id: string | null; confidence?: number | null }) => ({
          id: (r as { id: string }).id,
          article_id: (r as { article_id: number }).article_id,
          atom_id: (r as { atom_id: string | null }).atom_id,
          confidence: (r as { confidence?: number | null }).confidence ?? 1,
        }))
        );
      }
    }
  }
  if (hardFallbackInserted > 0) {
    logger.info("Hard fallback insults inserted", { jobId, chunkId: chunk.id, inserted: hardFallbackInserted });
  }
  logger.info("[DEBUG] Lexicon stage complete", {
    jobId,
    chunkId: chunk.id,
    mandatoryFindings: mandatoryFindings.length,
    hardFallbackInserted,
  });

  // 1b) Idempotency Check & Config Setup
  // Build logicVersion dynamically so cache invalidates automatically when prompts/passes change.
  const passSignature = DETECTION_PASSES.map((p) => `${p.name}:${p.model ?? "default"}`).join("|");
  const v2PromptContext =
    pipelineVersion === "v2" && typeof jobConfig.v2_prompt_context === "string" && jobConfig.v2_prompt_context.trim().length > 0
      ? jobConfig.v2_prompt_context.trim()
      : null;
  const v2FeatureSignature = pipelineVersion === "v2"
    ? `|v2ChunkMemory:${PIPELINE_V2_MEMORY_VERSION}|v2SceneMemory:${PIPELINE_V2_SCENE_MEMORY_VERSION}|v2ScriptMemory:${PIPELINE_V2_SCRIPT_MEMORY_VERSION}|v2Evidence:${PIPELINE_V2_EVIDENCE_PINNING_VERSION}`
    : "";
  const deepAuditorEnabled =
    typeof jobConfig.deep_auditor_enabled === "boolean" ? jobConfig.deep_auditor_enabled : config.ANALYSIS_DEEP_AUDITOR;
  const rationaleModel = config.OPENAI_RATIONALE_MODEL;
  const logicVersion = `pipeline:${PIPELINE_LOGIC_VERSION}|version:${pipelineVersion}${v2FeatureSignature}|evidenceGrounding:${PIPELINE_EVIDENCE_GROUNDING_VERSION}|profile:${analysisProfile}|engine:${analysisEngine}|deepAuditor:${deepAuditorEnabled}|auditorLayer:${config.AUDITOR_LAYER_VERSION}|rationaleModel:${rationaleModel}|router:${PROMPT_VERSIONS.router}|judge:${PROMPT_VERSIONS.judge}|violationSystem:${PROMPT_VERSIONS.violation_system}|auditor:${PROMPT_VERSIONS.auditor}|schema:${PROMPT_VERSIONS.schema}|passes:${passSignature}|passGating:${config.ANALYSIS_PASS_GATING_ENABLED ? PASS_GATING_VERSION : "off"}`;
  const forceFresh = jobConfig.force_fresh === true;
  const routerModel = typeof jobConfig.router_model === "string" && jobConfig.router_model.trim().length > 0
    ? jobConfig.router_model
    : config.OPENAI_ROUTER_MODEL;
  const judgeModel = typeof jobConfig.judge_model === "string" && jobConfig.judge_model.trim().length > 0
    ? jobConfig.judge_model
    : config.OPENAI_JUDGE_MODEL;
  const temperature = typeof jobConfig.temperature === "number"
    ? jobConfig.temperature
    : (config.DETERMINISTIC_MODE ? 0 : 0.4);
  const seed = typeof jobConfig.seed === "number"
    ? jobConfig.seed
    : (config.DETERMINISTIC_MODE ? 12345 : undefined);
  const maxRouter = typeof jobConfig.max_router_candidates === "number"
    ? jobConfig.max_router_candidates
    : 8;
  const analysisSignatureConfig = (jobConfig.analysis_signature as {
    chunk_size?: number;
    overlap_size?: number;
    total_chunks?: number;
    total_detection_passes?: number;
    memory_version?: string | null;
    scene_memory_version?: string | null;
    script_memory_version?: string | null;
    evidence_pinning_version?: string | null;
    summary_hash?: string | null;
    memory_hash?: string | null;
    summary_source?: "cache" | "generated" | "unavailable" | null;
    summary_generation_timestamp?: string | null;
    summary_model?: string | null;
    summary_version?: string | null;
  } | null) ?? null;
  const analysisSignatureBase = {
    job_id: jobId,
    script_id: scriptId,
    version_id: versionId,
    created_at: job.created_at ?? null,
    provider_name: "openai",
    model_name: judgeModel,
    model_version: null,
    router_model_name: routerModel,
    auditor_model_name: config.OPENAI_AUDITOR_MODEL,
    rationale_model_name: config.OPENAI_RATIONALE_MODEL,
    temperature,
    top_p: null,
    seed: seed ?? null,
    max_tokens: 4096,
    reasoning_effort: null,
    response_format: "json_object",
    pipeline_version: pipelineVersion,
    analysis_engine_version: analysisEngine,
    memory_version: analysisSignatureConfig?.memory_version ?? null,
    scene_memory_version: analysisSignatureConfig?.scene_memory_version ?? null,
    script_memory_version: analysisSignatureConfig?.script_memory_version ?? null,
    evidence_pinning_version: analysisSignatureConfig?.evidence_pinning_version ?? null,
    router_version: PROMPT_VERSIONS.router,
    grounding_version: PIPELINE_EVIDENCE_GROUNDING_VERSION,
    validator_version: config.AUDITOR_LAYER_VERSION,
    aggregation_version: PIPELINE_LOGIC_VERSION,
    auditor_version: PROMPT_VERSIONS.auditor,
    violation_system_version: config.VIOLATION_SYSTEM_VERSION,
    summary_hash: analysisSignatureConfig?.summary_hash ?? null,
    memory_hash: analysisSignatureConfig?.memory_hash ?? null,
    summary_source: analysisSignatureConfig?.summary_source ?? null,
    summary_generation_timestamp: analysisSignatureConfig?.summary_generation_timestamp ?? null,
    summary_model: analysisSignatureConfig?.summary_model ?? null,
    summary_version: analysisSignatureConfig?.summary_version ?? null,
    chunk_size: analysisSignatureConfig?.chunk_size ?? 2_500,
    overlap_size: analysisSignatureConfig?.overlap_size ?? 0,
    total_chunks: analysisSignatureConfig?.total_chunks ?? Math.max(0, job.progress_total - 1),
    total_detection_passes: analysisSignatureConfig?.total_detection_passes ?? DETECTION_PASSES.length,
    diagnostics_enabled: config.ENABLE_AI_DIAGNOSTICS,
    lineage_enabled: config.ENABLE_FINDING_LINEAGE,
  } as const;

  const runKey = computeChunkRunKey(chunkText, {
    router_model: routerModel,
    judge_model: judgeModel,
    temperature,
    seed: seed ?? 0,
    router_prompt_hash: jobConfig.router_prompt_hash,
    judge_prompt_hash: jobConfig.judge_prompt_hash,
  }, logicVersion);

  if (isDev) {
    logger.info("Chunk run key computed", { chunkId: chunk.id, runKey, logicVersion });
  }

  // Check cache table
  const { data: cachedRun } = forceFresh
    ? { data: null as null }
    : await supabase
        .from("analysis_chunk_runs")
        .select("ai_findings, raw_ai_findings, validated_ai_findings, truth_layer_meta, router_candidates")
        .eq("run_key", runKey)
        .maybeSingle();

  if (forceFresh) {
    logger.info("Force-fresh enabled: bypassing idempotency cache for this job", {
      jobId,
      chunkId: chunk.id,
      runKey,
    });
  }

  // Variables for subsequent steps
  let allFindings: FindingWithGlobal[] = [];
  let groundedFindingCount: number | null = null;
  let validatedFindingCount: number | null = null;
  let selectedIds: number[];
  let routerOutputJson: any = null;
  let multiPassResult: MultiPassDetectionResult | null = null;
  let multiPassEventUnderstanding: MultiPassDetectionResult["eventUnderstanding"] = null;
  let multiPassPassResults: MultiPassDetectionResult["passResults"] = [];

  const cachedValidated = ((cachedRun?.validated_ai_findings as any[]) || []) as FindingWithGlobal[];
  const cachedLegacy = ((cachedRun?.ai_findings as any[]) || []) as FindingWithGlobal[];
  const cachedRaw = ((cachedRun?.raw_ai_findings as any[]) || []) as FindingWithGlobal[];
  const hasValidatedCache = cachedValidated.length > 0;
  const hasLegacyFinalCache = Boolean(cachedRun) && !hasValidatedCache && cachedRaw.length === 0 && cachedLegacy.length > 0;
  const canUseCachedFinal = Boolean(cachedRun) && (hasValidatedCache || hasLegacyFinalCache);

  if (canUseCachedFinal && cachedRun) {
    const cachedMeta = (cachedRun.truth_layer_meta as Record<string, unknown> | null | undefined) ?? null;

    if (hasValidatedCache || hasLegacyFinalCache) {
      logger.info("Idempotency HIT: Using cached validated run results", {
        chunkId: chunk.id,
        runKey,
        cachedValidatedCount: cachedValidated.length,
        cachedLegacyCount: cachedLegacy.length,
        truthLayerMeta: cachedMeta,
      });
      await setChunkPhase(chunk.id, "cached");
      allFindings = sortFindingsStable((hasValidatedCache ? cachedValidated : cachedLegacy) as FindingWithGlobal[]);
    }
  } else {
    if (cachedRun) {
      logger.info("Idempotency cache contains advisory-only raw output; recomputing validation", {
        chunkId: chunk.id,
        runKey,
        cachedRawCount: cachedRaw.length,
        truthLayerMeta: (cachedRun.truth_layer_meta as Record<string, unknown> | null | undefined) ?? null,
      });
    } else {
      logger.info("Idempotency MISS: Executing AI pipeline", { chunkId: chunk.id, runKey });
    }

    // 2) Router (or high-recall bypass / deterministic no-op skip)
    const routerStartedAt = Date.now();

    if (config.HIGH_RECALL) {
      // High-recall dev mode: judge against ALL 25 articles
      selectedIds = Array.from({ length: 25 }, (_, i) => i + 1);
      logger.info("HIGH_RECALL mode: bypassing router, using all 25 articles", { chunkId: chunk.id });
    } else {
      await setChunkPhase(chunk.id, "router");
      const articleList = getScriptStandardRouterList();
      const routerArticleIds = articleList.map((a) => a.id);
      if (articleListsAreEquivalent(ALWAYS_CHECK_ARTICLES, routerArticleIds)) {
        selectedIds = [...ALWAYS_CHECK_ARTICLES].sort((a, b) => a - b);
        routerOutputJson = {
          skipped: true,
          reason: "always_check_covers_all_scannable_articles",
          candidate_articles: selectedIds.map((article_id) => ({ article_id, confidence: 1 })),
        };
        logger.info("Router skipped because ALWAYS_CHECK_ARTICLES already covers all scannable articles", {
          chunkId: chunk.id,
          selectedCount: selectedIds.length,
        });
      } else {
        try {
          throwIfAborted(signal);
          const routerOut = await callRouter(chunkText, articleList, {
            router_model: routerModel,
            temperature,
            seed,
            max_router_candidates: maxRouter,
          }, routerPrompt, { signal });
          throwIfAborted(signal);
          routerOutputJson = routerOut;
          const routerTrace = buildRouterTraceSummary(routerOut);
          const candidateIds = routerOut.candidate_articles.map((a: { article_id: number }) => a.article_id);
          selectedIds = [...new Set([...ALWAYS_CHECK_ARTICLES, ...candidateIds])].sort((a, b) => a - b).slice(0, 25);

          logger.info("[DEBUG] Router trace summary", {
            chunkId: chunk.id,
            runKey,
            candidateArticles: routerTrace.candidateArticles,
            candidateAtoms: routerTrace.candidateAtoms,
            confidence: routerTrace.confidence,
            sortedOrder: routerTrace.sortedOrder,
            hash: routerTrace.hash,
            model: routerModel,
            seed,
          });

          // Verification Log: Proof of determinism for Router
          if (isDev) {
            logger.info("Router deterministic output", {
              chunkId: chunk.id,
              sortedCandidates: candidateIds,
              model: routerModel,
              seed,
              runKey,
            });
          }
        } catch (e) {
          if (
            (e instanceof Error && (e.name === "AbortError" || e.name === "ChunkTimeoutError")) ||
            signal?.aborted
          ) {
            throwIfAborted(signal);
            throw e;
          }
          logger.warn("Router failed, using ALWAYS_CHECK_ARTICLES", { error: String(e) });
          selectedIds = [...ALWAYS_CHECK_ARTICLES];
        }
      }
    }
    const routerDurationMs = Date.now() - routerStartedAt;
    const selectedArticles: GCAMArticle[] = selectedIds.map((id) => getScriptStandardArticle(id));
    logger.info("Articles selected for Multi-Pass Judge", { chunkId: chunk.id, count: selectedIds.length, ids: selectedIds });
    logger.info("[DEBUG] Router stage complete", {
      jobId,
      chunkId: chunk.id,
      selectedArticleIds: selectedIds,
      selectedArticleCount: selectedIds.length,
      routerDurationMs,
    });
  logger.info("[DEBUG] Articles passed to multi-pass", {
      chunkId: chunk.id,
      selectedArticlesCount: selectedArticles.length,
      selectedArticleIds: selectedArticles.map(a => a.id),
    });

    // 3) Multi-Pass Detection (specialized scanners running in parallel)
    allFindings = [];
    try {
      const passExecutionPlan = planDetectionPassExecution(chunkText, selectedArticles, terms);
      await setChunkMultipassStart(chunk.id, Math.max(1, passExecutionPlan.activePasses.length));
      const multiPassStartedAt = Date.now();
      throwIfAborted(signal);
      multiPassResult = await runMultiPassDetection(
        chunkText,
        chunkStart,
        chunkEnd,
        selectedArticles,
        terms,
        { temperature, seed, analysis_signature_context: analysisSignatureBase },
        { chunkId: chunk.id },
        passExecutionPlan,
        v2PromptContext ?? undefined,
        signal,
        {
          jobId,
          chunkId: chunk.id,
          routerCandidates: routerOutputJson,
        }
      );
      throwIfAborted(signal);
      await setChunkPhase(chunk.id, "postprocess");
      logger.info("Post-multipass refinement starting", {
        jobId,
        chunkId: chunk.id,
        runKey,
        rawFindings: multiPassResult.findings.length,
        executedPassCount: multiPassResult.executedPassCount,
        skippedPassCount: multiPassResult.skippedPassCount,
      });
      if (config.DEBUG_TRACE_FINDING_PIPELINE) {
        traceFindingPipelineStage({
          jobId,
          chunkId: chunk.id,
          stageName: "After multi-pass refinement",
          functionName: "runMultiPassDetection",
        snapshots: multiPassResult.findings.slice(0, 5).map((finding) => ({
          traceId: (finding as { lineage_id?: string | null; finding_uuid?: string | null }).lineage_id ?? (finding as { finding_uuid?: string | null }).finding_uuid ?? "",
          reviewerArticleId: parseReviewerArticleId((finding as { detection_pass?: string | null }).detection_pass ?? null, finding.article_id ?? null),
          passName: (finding as { detection_pass?: string | null }).detection_pass ?? null,
          eventId: getFindingDeclaredEventId(finding),
          findingUuid: (finding as { finding_uuid?: string | null }).finding_uuid ?? null,
          pageNumber: (finding as { page_number?: number | null }).page_number ?? null,
          title_ar: finding.title_ar ?? null,
          description_ar: finding.description_ar ?? null,
          rationale_ar: finding.rationale_ar ?? null,
            canonical_atom: finding.canonical_atom ?? null,
            article_id: finding.article_id ?? null,
            claimedArticleId: finding.article_id ?? null,
            severity: finding.severity ?? null,
            confidence: finding.confidence ?? null,
            evidence_snippet: finding.evidence_snippet ?? null,
            quote: finding.evidence_snippet ?? null,
            start_offset: finding.start_offset_global ?? null,
            end_offset: finding.end_offset_global ?? null,
          })),
        });
      }
      
      // Enforce atom_ids and prefer literal local evidence from chunk offsets.
      const enforced = multiPassResult.findings.map(f => enforceAtomIds([f])[0]);
      const precisionRefined = enforced.map((f) => refineAtomPrecision(f));
      const evidencePinned = precisionRefined.map((f) => pinFindingEvidenceToChunk(f, chunkText));
      const groundedResults = evidencePinned.map((f) => {
        const passName = (f as { detection_pass?: string | null }).detection_pass ?? null;
        const judgeCallIndex = passName != null
          ? DETECTION_PASSES.findIndex((pass) => pass.name === passName)
          : -1;
        const startOffset = typeof f.location?.start_offset === "number" ? f.location.start_offset : null;
        const endOffset = typeof f.location?.end_offset === "number" ? f.location.end_offset : null;
        const hintOffset = startOffset;
        const evidenceSnippet = f.evidence_snippet ?? null;
        const findingHash = sha256(canonicalStringify({
          pass_name: passName,
          article_id: f.article_id ?? null,
          atom_id: f.atom_id ?? null,
          evidence_snippet: evidenceSnippet,
          start_offset: startOffset,
          end_offset: endOffset,
          hint_offset: hintOffset,
          title_ar: f.title_ar ?? null,
          description_ar: f.description_ar ?? null,
          rationale_ar: f.rationale_ar ?? null,
          confidence: f.confidence ?? null,
          detection_pass: f.detection_pass ?? null,
        }));
        logger.info("[GroundingDiagnostics] Finding input", {
          jobId,
          chunkId: chunk.id,
          pass_name: passName,
          judge_call_index: judgeCallIndex,
          article_id: f.article_id ?? null,
          atom_id: f.atom_id ?? null,
          evidence_snippet: evidenceSnippet,
          start_offset: startOffset,
          end_offset: endOffset,
          hint_offset: hintOffset,
          finding_hash: findingHash,
          evidence_hash: evidenceSnippet != null ? sha256(evidenceSnippet) : null,
        });
        const result = groundFindingEvidenceToChunk(f, chunkText, multiPassEventUnderstanding?.events || []);
        const findingId = (f as { canonical_finding_id?: string | null; finding_id?: string | null }).finding_id
          ?? (f as { canonical_finding_id?: string | null }).canonical_finding_id
          ?? null;
        logger.info("[GroundingDiagnostics] Finding evaluated", {
          jobId,
          chunkId: chunk.id,
          pass_name: passName,
          judge_call_index: judgeCallIndex,
          finding_id: findingId,
          article_id: f.article_id ?? null,
          atom_id: f.atom_id ?? null,
          evidence: result.diagnostics?.evidence ?? evidenceSnippet,
          evidence_snippet: evidenceSnippet,
          start_offset: startOffset,
          end_offset: endOffset,
          hint_offset: hintOffset,
          finding_hash: findingHash,
          evidence_hash: evidenceSnippet != null ? sha256(evidenceSnippet) : null,
          candidate_matches: result.diagnostics?.candidate_matches ?? [],
          selected_match: result.diagnostics?.selected_match ?? null,
          grounding_score: result.diagnostics?.grounding_score ?? 0,
          rejection_reason: result.diagnostics?.rejection_reason ?? null,
          grounded: result.grounded,
          method: result.method,
          reason: result.reason ?? null,
        });
        return result;
      });
      const grounded = groundedResults
        .filter((result) => result.grounded)
        .map((result) => {
          if (requiresStrictExactProof(result.finding) && !allowsStrictGroundingMethod(result.method)) {
            validatorWarnings.push({
              stage: "grounding",
              issue: "strict_exact_proof_required",
              articleId: result.finding.article_id ?? null,
              passName: result.finding.detection_pass ?? null,
              message: "Strict exact proof disagreement treated as advisory.",
            });
            logger.warn("Strict exact proof disagreement (advisory only)", {
              jobId,
              chunkId: chunk.id,
              runKey,
              article: result.finding.article_id,
              pass: result.finding.detection_pass ?? null,
              method: result.method,
              reason: result.reason ?? null,
            });
          }
          return result.finding;
        });
      await persistLineageEvents(
        groundedResults.map((result) => {
          const strictRejected =
            result.grounded &&
            requiresStrictExactProof(result.finding) &&
            !allowsStrictGroundingMethod(result.method);
          const reasonIfRemoved = !result.grounded
            ? (result.reason ?? result.diagnostics?.rejection_reason ?? "grounding_rejected")
            : strictRejected
              ? "strict_exact_proof_required"
              : null;
          return buildLineageEvent(result.finding, {
            jobId,
            chunkId: chunk.id,
            stageName: "grounding",
            passName: result.finding.detection_pass ?? null,
            reasonIfRemoved,
            metadata: {
              method: result.method,
              grounded: result.grounded,
            },
          });
        })
      );
      const enriched = grounded.map((f) => {
        const localStart = Math.max(0, f.location?.start_offset ?? 0);
        const localEnd = Math.min(chunkText.length, f.location?.end_offset ?? localStart);
        const fallback = localEnd > localStart ? chunkText.slice(localStart, localEnd) : "";
        if (f.evidence_snippet && isDetectionVerbatim(chunkText, f.evidence_snippet)) {
          return f;
        }
        if (fallback && isDetectionVerbatim(chunkText, fallback)) {
          return { ...f, evidence_snippet: fallback };
        }
        if (f.evidence_snippet && f.evidence_snippet.trim().length > 0) return f;
        return { ...f, evidence_snippet: fallback };
      });
      const qualityFiltered = enriched.filter((f) => {
        const qualityIssue = getEvidenceQualityIssue(f, chunkText);
        if (qualityIssue) {
          logger.warn("Low-quality evidence snippet detected", {
            chunkId: chunk.id,
            article: f.article_id,
            issue: qualityIssue,
            evidence: f.evidence_snippet?.slice(0, 80),
          });
          if (!objectiveEvidenceIssues.has(qualityIssue) || isValidatorAdvisoryIssue(qualityIssue)) {
            validatorWarnings.push({
              stage: "evidence_quality",
              issue: qualityIssue,
              articleId: f.article_id ?? null,
              passName: f.detection_pass ?? null,
              message: "Evidence quality disagreement treated as advisory.",
            });
            return true;
          }
          validatorWarnings.push({
            stage: "evidence_quality",
            issue: qualityIssue,
            articleId: f.article_id ?? null,
            passName: f.detection_pass ?? null,
            message: "Objective evidence corruption rejected before insert.",
          });
          const findingUuid = f.finding_uuid ?? f.lineage_id ?? buildFindingUuid({
            kind: "ai_finding",
            job_id: jobId,
            chunk_id: chunk.id,
            pass_name: f.detection_pass ?? null,
            article_id: f.article_id,
            atom_id: f.atom_id ?? null,
            canonical_atom: f.canonical_atom ?? null,
            title_ar: f.title_ar ?? null,
            description_ar: f.description_ar ?? "",
            evidence_snippet: f.evidence_snippet ?? "",
            start_offset_global: f.start_offset_global ?? 0,
            end_offset_global: f.end_offset_global ?? f.start_offset_global ?? 0,
            page_number: f.page_number ?? null,
            location: f.location ?? null,
          });
          logValidatorRejection({
            jobId,
            chunkId: chunk.id,
            runKey,
            stage: "evidence_quality",
            rule: qualityIssue,
            rejectionReason: "Objective evidence corruption rejected before insert.",
            finding: f,
            findingUuid,
            eventId: getFindingDeclaredEventId(f),
          });
          recordValidatorRejection(qualityIssue);
          return false;
        }
        return true;
      });
      const withGlobal = qualityFiltered.map((f) => toGlobalFinding(f, chunkStart));
      withGlobal.forEach((finding, index) => {
        ensureFindingLineageId(finding, {
          jobId,
          chunkId: chunk.id,
          passName: finding.detection_pass ?? null,
          index,
        });
      });
      logger.info("[DEBUG] Multi-pass refinement stage complete", {
        jobId,
        chunkId: chunk.id,
        runKey,
        rawFindingsCount: enforced.length,
        groundedCount: grounded.length,
        qualityFilteredCount: qualityFiltered.length,
        globalizedCount: withGlobal.length,
      });
      groundedFindingCount = grounded.length;
      logger.info("Post-multipass refinement completed", {
        jobId,
        chunkId: chunk.id,
        runKey,
        enforcedCount: enforced.length,
        precisionRefinedCount: precisionRefined.length,
        evidencePinnedCount: evidencePinned.length,
        groundedCount: grounded.length,
        groundingDroppedCount: groundedResults.length - grounded.length,
        strictExactProofDroppedCount: groundedResults.filter(
          (result) =>
            result.grounded &&
            requiresStrictExactProof(result.finding) &&
            !allowsStrictGroundingMethod(result.method)
        ).length,
        groundingMethods: groundedResults.reduce<Record<string, number>>((acc, result) => {
          acc[result.method] = (acc[result.method] ?? 0) + 1;
          return acc;
        }, {}),
        enrichedCount: enriched.length,
        qualityFilteredCount: qualityFiltered.length,
        lowQualityDroppedCount: enriched.length - qualityFiltered.length,
        globalizedCount: withGlobal.length,
      });
      
      // Final guardrail: keep only findings anchored to literal script text.
      const beforeVerbatimCount = withGlobal.length;
      logger.info("Verbatim guardrail starting", {
        jobId,
        chunkId: chunk.id,
        runKey,
        findingsToCheck: beforeVerbatimCount,
      });
      allFindings = withGlobal.map((f) => {
        const isExact = isDetectionVerbatim(chunkText, f.evidence_snippet);
        if (!isExact) {
          logger.warn("Evidence mismatch (advisory only)", {
            chunkId: chunk.id,
            article: f.article_id,
            evidence: f.evidence_snippet?.slice(0, 50),
            severity: f.severity
          });
          validatorWarnings.push({
            stage: "verbatim_guardrail",
            issue: "evidence_mismatch",
            articleId: f.article_id ?? null,
            passName: f.detection_pass ?? null,
            message: "Verbatim disagreement treated as advisory.",
          });
        }
        return f;
      });
      allFindings = sortFindingsStable(allFindings);
      logger.info("Verbatim guardrail completed", {
        jobId,
        chunkId: chunk.id,
        runKey,
        beforeVerbatim: beforeVerbatimCount,
        afterVerbatim: allFindings.length,
        dropped: beforeVerbatimCount - allFindings.length,
      });

      recordTelemetryFromFindings({
        jobId,
        stageName: "reviewer_output",
        findings: multiPassResult.findings,
      });
      
      logger.info("Multi-pass detection stats", {
        chunkId: chunk.id,
        runKey,
        totalPasses: multiPassResult.passResults.length,
        executedPasses: multiPassResult.executedPassCount,
        skippedPasses: multiPassResult.skippedPassCount,
        beforeVerbatim: beforeVerbatimCount,
        afterVerbatim: allFindings.length,
        dropped: beforeVerbatimCount - allFindings.length,
        duration: multiPassResult.totalDuration,
        passBreakdown: multiPassResult.passResults.map(r => ({
          pass: r.passName,
          findings: r.findings.length,
          duration: r.duration,
          skipped: r.skipped ?? false,
          reason: r.reason ?? null,
        }))
        });
        logger.info("Chunk multipass timings", {
          jobId,
          chunkId: chunk.id,
          runKey,
          routerDurationMs,
          multiPassDurationMs: Date.now() - multiPassStartedAt,
        });
      } catch (e) {
        if (
          (e instanceof Error && (e.name === "AbortError" || e.name === "ChunkTimeoutError")) ||
          signal?.aborted
        ) {
          throwIfAborted(signal);
          throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        logger.error("Multi-pass detection failed", { error: message, chunkId: chunk.id, runKey });
        await setChunkFailed(chunk.id, message);
        return;
      }

      if (!multiPassResult) {
        await setChunkFailed(chunk.id, "Multi-pass detection returned no result");
        return;
      }

      multiPassEventUnderstanding = multiPassResult.eventUnderstanding;
      multiPassPassResults = multiPassResult.passResults;

    // 4) Micro-windows (DISABLED for multi-pass - full chunk coverage is sufficient)
    // Multi-pass already provides comprehensive coverage, micro-windows add redundancy
    logger.info("Micro-windows skipped (multi-pass provides full coverage)", { chunkId: chunk.id });

    // 5) Dedupe + overlap
    const beforeDedupeCount = allFindings.length;
    const beforeCanonicalization = [...allFindings];
    allFindings = dedupeByHash(allFindings);
    const afterDedupeCount = allFindings.length;
    allFindings = overlapCollapse(allFindings);
    const afterOverlapCount = allFindings.length;
    allFindings = dropRedundantArticleFourFindings(allFindings);
    const afterArticleFourCollapseCount = allFindings.length;
      logger.info("[DEBUG] Dedupe/overlap stage complete", {
        jobId,
        chunkId: chunk.id,
        runKey,
        beforeDedupe: beforeDedupeCount,
      afterDedupe: afterDedupeCount,
      afterOverlap: afterOverlapCount,
      afterArticleFourCollapse: afterArticleFourCollapseCount,
    });
      logger.info("Dedupe + overlap stats", {
        chunkId: chunk.id,
        runKey,
        beforeDedupe: beforeDedupeCount,
      afterDedupe: afterDedupeCount,
      dedupeDropped: beforeDedupeCount - afterDedupeCount,
      afterOverlap: afterOverlapCount,
      overlapDropped: afterDedupeCount - afterOverlapCount,
        afterArticleFourCollapse: afterArticleFourCollapseCount,
        articleFourDropped: afterOverlapCount - afterArticleFourCollapseCount,
        finalAiFindings: afterArticleFourCollapseCount,
        lexiconFindings: mandatoryFindings.length,
      });
      recordTelemetryFromFindings({
        jobId,
        stageName: "merge",
        inputCount: beforeDedupeCount,
        findings: allFindings,
      });
      const canonicalizationKept = new Set(
        allFindings.map((finding) => ensureFindingLineageId(finding, {
          jobId,
        chunkId: chunk.id,
        passName: finding.detection_pass ?? null,
        index: null,
      }))
    );
    await persistLineageEvents([
      ...allFindings.map((finding) =>
        buildLineageEvent(finding, {
          jobId,
          chunkId: chunk.id,
          stageName: "canonicalization",
          passName: finding.detection_pass ?? null,
        })
      ),
      ...beforeCanonicalization
        .filter((finding) => {
          const lineageId = ensureFindingLineageId(finding, {
            jobId,
            chunkId: chunk.id,
            passName: finding.detection_pass ?? null,
            index: null,
          });
          return !canonicalizationKept.has(lineageId);
        })
        .map((finding) =>
          buildLineageEvent(finding, {
            jobId,
            chunkId: chunk.id,
            stageName: "canonicalization",
            passName: finding.detection_pass ?? null,
            reasonIfRemoved: "dedupe_overlap_article4",
          })
        ),
    ]);

    // CACHE PURGE / PERSIST
    logger.info("Persisting analysis_chunk_run started", {
      jobId,
      chunkId: chunk.id,
      runKey,
      findingsCount: allFindings.length,
      timeoutMs: NON_CRITICAL_DB_TIMEOUT_MS,
    });
    let runErr: { message: string } | null = null;
    try {
      const result: { error: { message: string } | null } = await withOperationTimeout<{ error: { message: string } | null }>(
        "Persist advisory analysis_chunk_run",
        NON_CRITICAL_DB_TIMEOUT_MS,
        supabase.from("analysis_chunk_runs").upsert({
          run_key: runKey,
          job_id: jobId,
          router_candidates: routerOutputJson,
          ai_findings: allFindings,
          raw_ai_findings: allFindings,
          validated_ai_findings: null,
          truth_layer_meta: {
            architecture: "advisory_model_plus_validator",
            stage: "advisory",
            advisory_count: allFindings.length,
            validated_count: null,
            auditor_layer_version: config.AUDITOR_LAYER_VERSION,
          },
        }, { onConflict: "run_key" })
      );
      runErr = result.error;
    } catch (error) {
      logger.warn("Timed out persisting analysis_chunk_run", {
        jobId,
        chunkId: chunk.id,
        runKey,
        error: error instanceof Error ? error.message : String(error),
        timeoutMs: NON_CRITICAL_DB_TIMEOUT_MS,
      });
    }
    throwIfAborted(signal);

    if (runErr) {
      logger.warn("Failed to persist analysis_chunk_run", { runKey, error: runErr.message });
    } else {
      logger.info("Persisted analysis_chunk_run", { runKey });
    }
  }

  // 6) Baseline multi-pass findings only.
  const baselineFindings = sortFindingsStable([...allFindings]);
  const baselineMetrics = computeContradictionMetrics(baselineFindings);
  const persistedFindings: FindingWithGlobal[] = baselineFindings;
  const legacyMetrics: Record<string, unknown> | null = null;
  const policyV1Metrics: Record<string, unknown> | null = null;
  const partialFinalizeRequested = await isPartialFinalizeRequested(jobId);
  if (partialFinalizeRequested) {
    logger.info("Partial finalize requested; keeping baseline multi-pass findings", {
      jobId,
      chunkId: chunk.id,
      baselineFindings: baselineFindings.length,
    });
  }
  throwIfAborted(signal);
  logger.info("[DEBUG] Validation stage complete", {
    jobId,
    chunkId: chunk.id,
    runKey,
    persistedFindingsCount: persistedFindings.length,
    analysisEngine,
  });
  validatedFindingCount = persistedFindings.length;
  const persistedLineage = new Set(
    persistedFindings.map((finding) => ensureFindingLineageId(finding, {
      jobId,
      chunkId: chunk.id,
      passName: finding.detection_pass ?? null,
      index: null,
    }))
  );
  await persistLineageEvents([
    ...persistedFindings.map((finding) =>
      buildLineageEvent(finding, {
        jobId,
        chunkId: chunk.id,
        stageName: "validation",
        passName: finding.detection_pass ?? null,
      })
    ),
    ...baselineFindings
      .filter((finding) => {
        const lineageId = ensureFindingLineageId(finding, {
          jobId,
          chunkId: chunk.id,
          passName: finding.detection_pass ?? null,
          index: null,
        });
        return !persistedLineage.has(lineageId);
      })
      .map((finding) =>
        buildLineageEvent(finding, {
          jobId,
          chunkId: chunk.id,
          stageName: "validation",
          passName: finding.detection_pass ?? null,
          reasonIfRemoved: "validation_filtered",
        })
      ),
  ]);
    await persistJudgeDiagnostic({
      diagnostic_kind: "validated_snapshot",
      job_id: jobId,
      chunk_id: chunk.id,
    prompt_hash: "",
    router_candidates: routerOutputJson,
    raw_judge_response: "",
    parsed_judge_response: null,
    parsed_finding_count: 0,
    validated_finding_count: validatedFindingCount,
    validated_findings_json: persistedFindings,
  });
  logger.info("Analysis contradiction metrics", {
    jobId,
    chunkId: chunk.id,
    runKey,
    baselineMetrics,
    legacyMetrics,
    policyV1Metrics,
    persistedCount: persistedFindings.length,
    engine: analysisEngine,
  });

  throwIfAborted(signal);
  if (await isJobCancelled(jobId)) {
    await setChunkFailed(chunk.id, "Cancelled by user");
    throw new JobCancelledError();
  }

  // 7) Preserve reviewer ownership; only enrich metadata and compute severity from factors when present.
  const ownershipRejectedFindings: Array<{ article_id: number | null | undefined; detection_pass?: string | null }> = [];
  let canonicalTitleGeneratedCount = 0;
  let reviewerTitleUsedCount = 0;
  let resolvedFindings = sortFindingsStable(
    persistedFindings
      .map((f) => {
        let article_id = f.article_id;
        const atom_id = f.atom_id ?? null;
        let severity = f.severity ?? null;
        const canonical_atoms = (f as { canonical_atoms?: string[] | null }).canonical_atoms;
        const canonicalAtom = Array.isArray(canonical_atoms) && canonical_atoms.length > 0
          ? canonical_atoms[0] ?? (f as { canonical_atom?: string | null }).canonical_atom ?? null
          : (f as { canonical_atom?: string | null }).canonical_atom ?? null;
        const intensity = (f as { intensity?: number | null }).intensity ?? null;
        const context_impact = (f as { context_impact?: number | null }).context_impact ?? null;
        const legal_sensitivity = (f as { legal_sensitivity?: number | null }).legal_sensitivity ?? null;
        const audience_risk = (f as { audience_risk?: number | null }).audience_risk ?? null;
        const reviewerArticleId = parseReviewerArticleId((f as { detection_pass?: string | null }).detection_pass ?? null, article_id);
        const traceId = (f as { lineage_id?: string | null }).lineage_id ?? "";
        const validatorBypassReasons: string[] = [];
        let validatorDecision: "accepted" | "rejected" = "accepted";
        let validatorDropReason: string | null = null;

        if (!(typeof article_id === "number" && Number.isInteger(article_id) && article_id >= 1)) {
          ownershipRejectedFindings.push({
            article_id,
            detection_pass: (f as { detection_pass?: string | null }).detection_pass ?? null,
          });
          return null;
        }

        if (severity == null && canonicalAtom && (intensity != null || context_impact != null || legal_sensitivity != null || audience_risk != null)) {
          severity = calculateSeverity({
            canonical_atom: canonicalAtom,
            intensity: intensity ?? 1,
            context_impact: context_impact ?? 1,
            legal_sensitivity: legal_sensitivity ?? undefined,
            audience_risk: audience_risk ?? undefined,
          });
        }
        if (severity == null) severity = "medium";
        return {
          ...f,
          article_id,
          atom_id,
          severity,
          canonical_atom: canonicalAtom,
          intensity,
          context_impact,
          legal_sensitivity,
          audience_risk,
        };
      })
      .filter((finding): finding is (typeof persistedFindings)[number] => finding != null)
  );

  if (ownershipRejectedFindings.length > 0) {
    logger.warn("Dropped findings with unresolved ownership before persistence", {
      jobId,
      chunkId: chunk.id,
      droppedCount: ownershipRejectedFindings.length,
      articleIds: ownershipRejectedFindings.map((finding) => finding.article_id ?? null),
      detectionPasses: ownershipRejectedFindings.map((finding) => finding.detection_pass ?? null),
    });
  }

  if (isMemory2Mode(job)) {
    const beforeGuard = resolvedFindings.length;
    const guardResult = applyMemory2SanityGuards(resolvedFindings, normalizedText, chunk.text, validatorAuditMode);
    resolvedFindings = sortFindingsStable(guardResult.accepted);
    const droppedByGuard = guardResult.rejected.length;
    if (droppedByGuard > 0) {
      logger.warn("Memory2 sanity guards flagged findings before persistence", {
        jobId,
        chunkId: chunk.id,
        droppedByGuard,
        beforeGuard,
        afterGuard: resolvedFindings.length,
      });
    }
    await persistMemory2SanityTrace({
      job,
      chunk,
      beforeCount: beforeGuard,
      acceptedCount: resolvedFindings.length,
      rejected: guardResult.rejected,
    });
  }

  recordTelemetryFromFindings({
    jobId,
    stageName: "validator",
    inputCount: persistedFindings.length,
    findings: resolvedFindings,
  });

  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
      traceFindingPipelineStage({
        jobId,
        chunkId: chunk.id,
        stageName: "Auditor",
        functionName: "resolvedFindings.flatMap",
        stageChunkIndex: chunk.chunk_index,
        snapshots: resolvedFindings.slice(0, 5).map((finding) => ({
        traceId: (finding as { lineage_id?: string | null; finding_uuid?: string | null }).lineage_id ?? (finding as { finding_uuid?: string | null }).finding_uuid ?? "",
        reviewerArticleId: parseReviewerArticleId((finding as { detection_pass?: string | null }).detection_pass ?? null, finding.article_id ?? null),
        passName: finding.detection_pass ?? null,
        eventId: getFindingDeclaredEventId(finding),
        findingUuid: (finding as { finding_uuid?: string | null }).finding_uuid ?? null,
        pageNumber: (finding as { page_number?: number | null }).page_number ?? null,
        title_ar: finding.title_ar ?? null,
        description_ar: finding.description_ar ?? null,
        rationale_ar: finding.rationale_ar ?? null,
        canonical_atom: finding.canonical_atom ?? null,
        article_id: finding.article_id ?? null,
        claimedArticleId: finding.article_id ?? null,
        severity: finding.severity ?? null,
        confidence: finding.confidence ?? null,
        evidence_snippet: finding.evidence_snippet ?? null,
        quote: finding.evidence_snippet ?? null,
        start_offset: finding.start_offset_global ?? null,
        end_offset: finding.end_offset_global ?? null,
      })),
    });
  }

  await runBenchmarkInstrumentation({
    jobId,
    chunkId: chunk.id,
    runKey,
    chunkStart,
    chunkEnd,
    chunkText,
    routerOutputJson,
    job: structuredClone(job),
    chunk: structuredClone(chunk),
    allFindings: structuredClone(allFindings),
    resolvedFindings: structuredClone(resolvedFindings),
    multiPassEventUnderstanding: multiPassEventUnderstanding ? structuredClone(multiPassEventUnderstanding) : null,
    multiPassPassResults: structuredClone(multiPassPassResults),
  });

  if (config.VIOLATION_SYSTEM_VERSION === "v5" && multiPassEventUnderstanding) {
    try {
      const noteDetectionResult = await runNotesDetection(
        chunk.text,
        multiPassEventUnderstanding,
        { temperature, seed: seed ?? 0 },
        {
          jobId,
          chunkId: chunk.id,
          signal,
        },
      );

      const noteRows = toNoteInsertRows(jobId, noteDetectionResult.notes);
      const noteRowCounts = countNoteCategoriesFromArray(noteRows);
      logger.info("Notes pipeline completed", {
        jobId,
        chunkId: chunk.id,
        noteCount: noteRows.length,
        executedPassCount: noteDetectionResult.executedPassCount,
        skippedPassCount: noteDetectionResult.skippedPassCount,
        totalDurationMs: noteDetectionResult.totalDuration,
      });

      let persistStatus: "succeeded" | "failed" | "skipped" = "skipped";
      let persistedCount = 0;
      let persistError: string | null = null;

      if (noteRows.length > 0) {
        const { data: insertedNotes, error: notesError } = await withOperationTimeout<{
          data: Array<{ id: string }> | null;
          error: { message: string } | null;
        }>(
          "Upsert analysis_notes",
          NON_CRITICAL_DB_TIMEOUT_MS,
          supabase
            .from("analysis_notes")
            .upsert(noteRows, {
              onConflict: "job_id,reviewer,event_id,category,title",
              ignoreDuplicates: false,
            })
            .select("id")
        );

        if (notesError) {
          persistStatus = "failed";
          persistError = notesError.message;
          logger.warn("Notes upsert failed", {
            jobId,
            chunkId: chunk.id,
            error: notesError.message,
            noteCount: noteRows.length,
          });
        } else {
          persistStatus = "succeeded";
          persistedCount = insertedNotes?.length ?? noteRows.length;
          logger.info("Notes upsert complete", {
            jobId,
            chunkId: chunk.id,
            inserted: insertedNotes?.length ?? 0,
            noteCount: noteRows.length,
          });
        }
      }
      logNotePipelineStage({
        jobId,
        chunkId: chunk.id,
        stageLabel: "analysis_notes",
        actionLabel: "Persisted",
        noteCounts: noteRowCounts,
        extra: {
          persistStatus,
          persistedCount,
          attemptedCount: noteRows.length,
          ...(persistError ? { error: persistError } : {}),
        },
      });
    } catch (error) {
      logger.warn("Notes pipeline failed but analysis will continue", {
        jobId,
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throwIfAborted(signal);
  await setChunkPhase(chunk.id, "aggregating");

  // 8) Insert findings (batch upsert with logging). Derive excerpt from canonical when available.
  throwIfAborted(signal);
  if (await isJobCancelled(jobId)) {
    await setChunkFailed(chunk.id, "Cancelled by user");
    throw new JobCancelledError();
  }
  if (resolvedFindings.length > 0) {
    const insertStartedAt = Date.now();
    const sceneIndex = buildSceneIndex(normalizedText);
    let postCanonicalEvidenceDroppedCount = 0;
    let canonicalModelMismatchDroppedCount = 0;
    let explicitSceneMismatchDroppedCount = 0;
    let storedEvidencePassedCount = 0;
    let storedEvidenceDroppedCount = 0;
    let storedEvidenceBypassedCount = 0;
    let eventConsistencyPassedCount = 0;
    let eventConsistencyDroppedCount = 0;
    let eventConsistencyBypassedCount = 0;
    let passSpecificPassedCount = 0;
    let passSpecificDroppedCount = 0;
    let passSpecificBypassedCount = 0;
    let canonicalModelPassedCount = 0;
    let explicitScenePassedCount = 0;
    const rows = resolvedFindings.flatMap((f) => {
      const reviewerArticleId = parseReviewerArticleId((f as { detection_pass?: string | null }).detection_pass ?? null, f.article_id ?? null);
      const traceId = (f as { lineage_id?: string | null }).lineage_id ?? "";
      const findingEventId = getFindingDeclaredEventId(f);
      const validatorBypassReasons: string[] = [];
      let validatorDecision: "accepted" | "rejected" = "accepted";
      let validatorDropReason: string | null = null;
      const initialStart = f.start_offset_global ?? 0;
      const initialEnd = f.end_offset_global ?? initialStart;
      let start = initialStart;
      let end = initialEnd;
      const hasSaneGlobalOffsets =
        normalizedText != null &&
        start >= 0 &&
        end > start &&
        end <= normalizedText.length &&
        (end - start) <= MAX_EVIDENCE_SPAN;

      const modelSnippet = typeof f.evidence_snippet === "string" ? f.evidence_snippet : "";
      const structuredEvent =
        config.VIOLATION_SYSTEM_VERSION === "v5" && multiPassEventUnderstanding
          ? getStructuredEventById(multiPassEventUnderstanding.events, findingEventId)
          : null;
      if (config.VIOLATION_SYSTEM_VERSION === "v5" && multiPassEventUnderstanding && findingEventId != null && !structuredEvent) {
        const findingUuid = f.finding_uuid ?? f.lineage_id ?? null;
        logValidatorRejection({
          jobId,
          chunkId: chunk.id,
          runKey,
          stage: "event_resolution",
          rule: "event_resolution_failure",
          rejectionReason: "Finding event id could not be resolved to a structured event.",
          finding: f,
          findingUuid,
          eventId: findingEventId,
        });
        validatorDecision = "rejected";
        validatorDropReason = "event_resolution_failure";
        if (config.DEBUG_TRACE_FINDING_PIPELINE) {
          traceFindingPipelineStage({
            jobId,
            chunkId: chunk.id,
            stageName: "Validator",
            functionName: "getStructuredEventById",
            stageChunkIndex: chunk.chunk_index,
            snapshots: [buildTraceSnapshotFromFinding(f, {
              traceId,
              reviewerArticleId,
              passName: f.detection_pass ?? null,
              eventId: findingEventId,
              validatorDecision,
              dropReason: validatorDropReason,
              bypassReason: null,
            })],
          });
        }
        validatorWarnings.push({
          stage: "event_resolution",
          issue: "event_resolution_failure",
          articleId: f.article_id ?? null,
          passName: f.detection_pass ?? null,
          message: "Finding event id could not be resolved to a structured event.",
        });
        return [];
      }
      let canonicalSnippet = hasSaneGlobalOffsets ? normalizedText!.slice(start, end) : "";
      // Prefer the structured event quote in V5 so report evidence stays rooted in the event layer.
      let excerpt = structuredEvent?.quote ?? (canonicalSnippet.length > 0 ? canonicalSnippet : modelSnippet);
      const evidenceAlignedFinding = structuredEvent ? { ...f, evidence_snippet: excerpt } : f;

      let finalEvidenceIssue = getStoredEvidenceQualityIssue(
        excerpt,
        normalizedText,
        hasSaneGlobalOffsets ? start : null,
        hasSaneGlobalOffsets ? end : null,
      );
      if (finalEvidenceIssue) {
        logger.warn("Low-quality final evidence excerpt (objective corruption only)", {
          jobId,
          chunkId: chunk.id,
          runKey,
          article: f.article_id,
          issue: finalEvidenceIssue,
          excerpt: excerpt.slice(0, 80),
          modelSnippet: modelSnippet.slice(0, 80),
          canonicalSnippet: canonicalSnippet.slice(0, 80),
        });
        if (objectiveEvidenceIssues.has(finalEvidenceIssue) && !isValidatorAdvisoryIssue(finalEvidenceIssue)) {
          validatorDecision = "rejected";
          validatorDropReason = finalEvidenceIssue;
          logValidatorRejection({
            jobId,
            chunkId: chunk.id,
            runKey,
            stage: "stored_evidence_quality",
            rule: finalEvidenceIssue,
            rejectionReason: "Objective evidence corruption rejected before insert.",
            finding: f,
            findingUuid: f.finding_uuid ?? f.lineage_id ?? null,
            eventId: findingEventId,
          });
          recordValidatorRejection(finalEvidenceIssue);
          if (config.DEBUG_TRACE_FINDING_PIPELINE) {
            traceFindingPipelineStage({
              jobId,
              chunkId: chunk.id,
              stageName: "Validator",
              functionName: "getStoredEvidenceQualityIssue",
              stageChunkIndex: chunk.chunk_index,
              snapshots: [buildTraceSnapshotFromFinding(f, {
                traceId,
                reviewerArticleId,
                passName: f.detection_pass ?? null,
                validatorDecision,
                dropReason: validatorDropReason,
                bypassReason: null,
              })],
            });
          }
          postCanonicalEvidenceDroppedCount++;
          storedEvidenceDroppedCount++;
          validatorWarnings.push({
            stage: "stored_evidence_quality",
            issue: finalEvidenceIssue,
            articleId: f.article_id ?? null,
            passName: f.detection_pass ?? null,
            message: "Objective evidence corruption rejected before insert.",
          });
          return [];
        }
        storedEvidenceBypassedCount++;
        validatorBypassReasons.push(finalEvidenceIssue);
        validatorWarnings.push({
          stage: "stored_evidence_quality",
          issue: finalEvidenceIssue,
          articleId: f.article_id ?? null,
          passName: f.detection_pass ?? null,
          message: "Stored evidence disagreement treated as advisory.",
        });
      }
      if (!finalEvidenceIssue) {
        storedEvidencePassedCount++;
      }

      const eventConsistencyResult =
        config.VIOLATION_SYSTEM_VERSION === "v5" && multiPassEventUnderstanding
          ? getEventConsistencyIssue(evidenceAlignedFinding, multiPassEventUnderstanding.events)
          : null;
      if (eventConsistencyResult?.issue) {
        if (eventConsistencyResult.issue === "event_evidence_mismatch" || eventConsistencyResult.issue === "event_span_mismatch") {
          logger.info("Event consistency mismatch (rejected)", {
            jobId,
            chunkId: chunk.id,
            runKey,
            article: f.article_id,
            pass: f.detection_pass ?? null,
            canonicalAtom: f.canonical_atom ?? null,
            issue: eventConsistencyResult.issue,
            matchedEventId: eventConsistencyResult.matchedEvent?.event_id ?? null,
            matchedScore: eventConsistencyResult.matchedScore,
            runnerUpScore: eventConsistencyResult.runnerUpScore,
            excerpt: excerpt.slice(0, 120),
          });
          eventConsistencyDroppedCount++;
          continue;
        }
        logger.warn("Event consistency issue (advisory only)", {
          jobId,
          chunkId: chunk.id,
          runKey,
          article: f.article_id,
          pass: f.detection_pass ?? null,
          canonicalAtom: f.canonical_atom ?? null,
          issue: eventConsistencyResult.issue,
          matchedEventId: eventConsistencyResult.matchedEvent?.event_id ?? null,
          matchedScore: eventConsistencyResult.matchedScore,
          runnerUpScore: eventConsistencyResult.runnerUpScore,
          excerpt: excerpt.slice(0, 120),
        });
        eventConsistencyPassedCount++;
        eventConsistencyBypassedCount++;
        validatorBypassReasons.push(eventConsistencyResult.issue);
        validatorWarnings.push({
          stage: "event_consistency",
          issue: eventConsistencyResult.issue,
          articleId: f.article_id ?? null,
          passName: f.detection_pass ?? null,
          message: "Event consistency disagreement treated as advisory.",
        });
      } else {
        eventConsistencyPassedCount++;
      }

      if (config.VIOLATION_SYSTEM_VERSION === "v5" && multiPassEventUnderstanding) {
        const quoteEventId = eventConsistencyResult?.matchedEvent?.event_id ?? null;
        const pageEventId = quoteEventId;
        if (
          findingEventId != null && findingEventId !== quoteEventId
        ) {
          const expectedEvent = findingEventId;
          const actualEvent = quoteEventId ?? pageEventId ?? null;
          const findingUuid = f.finding_uuid ?? f.lineage_id ?? buildFindingUuid({
            kind: "ai_finding",
            job_id: jobId,
            chunk_id: chunk.id,
            pass_name: f.detection_pass ?? null,
            article_id: f.article_id,
            atom_id: f.atom_id ?? null,
            canonical_atom: f.canonical_atom ?? null,
            title_ar: f.title_ar ?? null,
            description_ar: f.description_ar ?? "",
            evidence_snippet: excerpt,
            start_offset_global: start,
            end_offset_global: end,
            page_number: pageNumAt(start),
            location: f.location ?? null,
          });
          logEvidenceIntegrityFailure({
            jobId,
            chunkId: chunk.id,
            runKey,
            finding: f,
            findingUuid,
            expectedEvent,
            actualEvent,
          });
          validatorDecision = "rejected";
          validatorDropReason = "evidence_integrity_failure";
          logValidatorRejection({
            jobId,
            chunkId: chunk.id,
            runKey,
            stage: "evidence_integrity",
            rule: "evidence_integrity_failure",
            rejectionReason: "Finding event id did not match the matched structured event.",
            finding: f,
            findingUuid,
            eventId: findingEventId,
          });
          recordValidatorRejection("evidence_integrity_failure");
          if (config.DEBUG_TRACE_FINDING_PIPELINE) {
            traceFindingPipelineStage({
              jobId,
              chunkId: chunk.id,
              stageName: "Validator",
              functionName: "evidence_integrity",
              stageChunkIndex: chunk.chunk_index,
              snapshots: [buildTraceSnapshotFromFinding(f, {
                traceId,
                reviewerArticleId,
                passName: f.detection_pass ?? null,
                eventId: findingEventId,
                validatorDecision,
                dropReason: validatorDropReason,
                bypassReason: null,
              })],
            });
          }
          validatorWarnings.push({
            stage: "evidence_integrity",
            issue: "evidence_integrity_failure",
            articleId: f.article_id ?? null,
            passName: f.detection_pass ?? null,
            message: "Finding event id did not match the matched structured event.",
          });
          return [];
        }
      }

      if (config.VIOLATION_SYSTEM_VERSION !== "v5") {
        const passSpecificEvidenceIssue = getPassSpecificEvidenceIssue(evidenceAlignedFinding, excerpt, normalizedText, sceneIndex);
        if (passSpecificEvidenceIssue) {
          logger.warn("Pass-specific final evidence issue (advisory only)", {
            jobId,
            chunkId: chunk.id,
            runKey,
            article: f.article_id,
            pass: f.detection_pass ?? null,
            canonicalAtom: f.canonical_atom ?? null,
            issue: passSpecificEvidenceIssue,
            excerpt: excerpt.slice(0, 120),
          });
          passSpecificBypassedCount++;
          validatorBypassReasons.push(passSpecificEvidenceIssue);
          validatorWarnings.push({
            stage: "pass_specific",
            issue: passSpecificEvidenceIssue,
            articleId: f.article_id ?? null,
            passName: f.detection_pass ?? null,
            message: "Pass-specific semantic disagreement treated as advisory.",
          });
        }
      }
      passSpecificPassedCount++;

      if (canonicalSnippet.length > 0 && modelSnippet.length > 0 && !snippetsReasonablyAlign(modelSnippet, canonicalSnippet)) {
        logger.warn("Canonical/model evidence mismatch (advisory only)", {
          jobId,
          chunkId: chunk.id,
          runKey,
          article: f.article_id,
          modelSnippet: modelSnippet.slice(0, 120),
          canonicalSnippet: canonicalSnippet.slice(0, 120),
        });
        canonicalModelMismatchDroppedCount++;
        validatorBypassReasons.push("canonical_model_mismatch");
        validatorWarnings.push({
          stage: "canonical_model_alignment",
          issue: "canonical_model_mismatch",
          articleId: f.article_id ?? null,
          passName: f.detection_pass ?? null,
          message: "Canonical/model disagreement treated as advisory.",
        });
      } else {
        canonicalModelPassedCount++;
      }

      if (hasExplicitSceneMismatch(f.rationale_ar ?? null, sceneIndex, f.start_offset_global ?? null)) {
        logger.warn("Explicit scene mismatch between rationale and resolved offset (advisory only)", {
          jobId,
          chunkId: chunk.id,
          runKey,
          article: f.article_id,
          rationale: (f.rationale_ar ?? "").slice(0, 160),
          excerpt: excerpt.slice(0, 120),
          startOffsetGlobal: f.start_offset_global ?? null,
        });
        explicitSceneMismatchDroppedCount++;
        validatorBypassReasons.push("explicit_scene_mismatch");
        validatorWarnings.push({
          stage: "scene_alignment",
          issue: "explicit_scene_mismatch",
          articleId: f.article_id ?? null,
          passName: f.detection_pass ?? null,
          message: "Scene mismatch treated as advisory.",
        });
      } else {
        explicitScenePassedCount++;
      }

      if (config.DEBUG_TRACE_FINDING_PIPELINE) {
        traceFindingPipelineStage({
          jobId,
          chunkId: chunk.id,
          stageName: "Validator",
          functionName: "getStoredEvidenceQualityIssue / getEventConsistencyIssue / snippetsReasonablyAlign / hasExplicitSceneMismatch",
          stageChunkIndex: chunk.chunk_index,
          snapshots: [buildTraceSnapshotFromFinding(f, {
            traceId,
            reviewerArticleId,
            passName: f.detection_pass ?? null,
            validatorDecision,
            dropReason: validatorDropReason,
            bypassReason: validatorBypassReasons.length > 0 ? validatorBypassReasons.join("; ") : null,
          })],
        });
      }

      const titleNormalizationDecision = normalizeFindingTitleDecision({
        titleAr: f.title_ar,
        rationaleAr: f.rationale_ar ?? null,
        descriptionAr: f.description_ar ?? null,
        evidenceSnippet: excerpt,
        source: f.source ?? "ai",
        detectionPass: (f as { detection_pass?: string }).detection_pass ?? null,
        articleId: f.article_id,
        canonicalAtom: f.canonical_atom ?? null,
        allowSemanticRewrite: config.VIOLATION_SYSTEM_VERSION !== "v5",
      });
      if (config.TITLE_NORMALIZATION_AUDIT) {
        logger.info("Title normalization audit", {
          jobId,
          chunkId: chunk.id,
          articleId: f.article_id,
          passName: (f as { detection_pass?: string }).detection_pass ?? null,
          source: f.source ?? "ai",
          reviewerTitle: titleNormalizationDecision.originalTitle,
          normalizedTitle: titleNormalizationDecision.title,
          reason: titleNormalizationDecision.reason,
          ruleName: titleNormalizationDecision.ruleName,
          technicalChanged: titleNormalizationDecision.technicalChanged,
          semanticChanged: titleNormalizationDecision.semanticChanged,
          changed: titleNormalizationDecision.changed,
        });
      }
      const title_ar = titleNormalizationDecision.title;
      const canonicalTitleAr = f.canonical_atom ? getAtomDefinition(f.canonical_atom)?.title_ar ?? null : null;
      if (canonicalTitleAr && title_ar === canonicalTitleAr) {
        canonicalTitleGeneratedCount++;
      } else if (!canonicalTitleAr && typeof title_ar === "string" && title_ar.trim().length > 0) {
        reviewerTitleUsedCount++;
      }
      const h = evidenceHash(
        f.article_id,
        f.atom_id ?? null,
        start,
        end,
        excerpt
      );
      const lineageId = ensureFindingLineageId(f, {
        jobId,
        chunkId: chunk.id,
        passName: f.detection_pass ?? null,
        index: null,
      });
      const findingPageNumber = pageNumAt(start);
      return [{
        job_id: jobId,
        script_id: scriptId,
        version_id: versionId,
        source: f.source ?? "ai",
        finding_uuid: f.finding_uuid ?? buildFindingUuid({
          kind: "ai_finding",
          job_id: jobId,
          chunk_id: chunk.id,
          pass_name: f.detection_pass ?? null,
          article_id: f.article_id,
          atom_id: f.atom_id ?? null,
          canonical_atom: f.canonical_atom ?? null,
          title_ar,
          description_ar: f.description_ar ?? "",
          evidence_snippet: excerpt,
          start_offset_global: start,
          end_offset_global: end,
          page_number: findingPageNumber,
          location: f.location ?? null,
        }),
        article_id: f.article_id,
        atom_id: f.atom_id ?? null,
        severity: f.severity,
        confidence: f.confidence,
        title_ar,
        description_ar: f.description_ar ?? "",
        evidence_snippet: excerpt,
        start_offset_global: start,
        end_offset_global: end,
        start_line_chunk: f.location?.start_line ?? null,
        end_line_chunk: f.location?.end_line ?? null,
        location: {
          ...f.location,
          run_key: runKey,
          v3: {
            depiction_type: f.depiction_type ?? "unknown",
            speaker_role: f.speaker_role ?? "unknown",
            context_window_id: f.context_window_id ?? null,
            context_confidence: f.context_confidence ?? null,
            lexical_confidence: f.lexical_confidence ?? null,
            policy_confidence: f.policy_confidence ?? null,
            rationale_ar: f.rationale_ar ?? null,
            final_ruling: f.final_ruling ?? null,
            narrative_consequence: f.narrative_consequence ?? "unknown",
            detection_pass: f.detection_pass ?? null,
            event_id: findingEventId,
            policy_links: f.policy_links ?? [],
            primary_article_id: (f as { primary_article_id?: number }).primary_article_id ?? f.article_id,
            related_article_ids: (f as { related_article_ids?: number[] }).related_article_ids ?? [],
            canonical_finding_id: (f as { canonical_finding_id?: string }).canonical_finding_id ?? null,
            pillar_id: (f as { pillar_id?: string }).pillar_id ?? null,
            secondary_pillar_ids: (f as { secondary_pillar_ids?: string[] }).secondary_pillar_ids ?? [],
          },
        },
        lineage_id: lineageId,
        parent_lineage_id: f.parent_lineage_id ?? null,
        canonical_hash: f.canonical_hash ?? null,
        evidence_hash: h,
        rationale_ar: f.rationale_ar ?? null,
        canonical_atom: f.canonical_atom ?? null,
        intensity: f.intensity ?? null,
        context_impact: f.context_impact ?? null,
        legal_sensitivity: f.legal_sensitivity ?? null,
        audience_risk: f.audience_risk ?? null,
        page_number: findingPageNumber,
        ...(() => {
          const pl = computePageLocalSpan(start, end, pageRows);
          return {
            start_offset_page: pl.start_offset_page,
            end_offset_page: pl.end_offset_page,
          };
        })(),
        ...buildCanonicalAnchorPayload({
          startGlobal: start,
          endGlobal: end,
          pageNumber: findingPageNumber,
          pageRows,
          anchorText: excerpt,
          documentContent: normalizedText,
        }),
      }];
    });

    recordTelemetryFromFindings({
      jobId,
      stageName: "auditor",
      inputCount: resolvedFindings.length,
      findings: rows,
    });

    if (config.DEBUG_TRACE_FINDING_PIPELINE) {
      traceFindingPipelineStage({
        jobId,
        chunkId: chunk.id,
        stageName: "Database Insert",
        functionName: "analysis_findings row builder",
        stageChunkIndex: chunk.chunk_index,
        snapshots: rows.slice(0, 5).map((row) => ({
          traceId: (row as { lineage_id?: string | null; finding_uuid?: string | null }).lineage_id ?? (row as { finding_uuid?: string | null }).finding_uuid ?? "",
          reviewerArticleId: parseReviewerArticleId((row as { location?: { v3?: { detection_pass?: string | null } } }).location?.v3?.detection_pass ?? null, (row as { article_id?: number | null }).article_id ?? null),
          passName: (row as { location?: { v3?: { detection_pass?: string | null } } }).location?.v3?.detection_pass ?? null,
          eventId: getRowEventId(row),
          findingUuid: (row as { finding_uuid?: string | null }).finding_uuid ?? null,
          pageNumber: (row as { page_number?: number | null }).page_number ?? null,
          title_ar: (row as { title_ar?: string | null }).title_ar ?? null,
          description_ar: (row as { description_ar?: string | null }).description_ar ?? null,
          rationale_ar: (row as { rationale_ar?: string | null }).rationale_ar ?? null,
          canonical_atom: (row as { canonical_atom?: string | null }).canonical_atom ?? null,
          article_id: (row as { article_id?: number | null }).article_id ?? null,
          claimedArticleId: (row as { article_id?: number | null }).article_id ?? null,
          severity: (row as { severity?: string | null }).severity ?? null,
          confidence: (row as { confidence?: number | null }).confidence ?? null,
          evidence_snippet: (row as { evidence_snippet?: string | null }).evidence_snippet ?? null,
          quote: (row as { evidence_snippet?: string | null }).evidence_snippet ?? null,
          start_offset: (row as { start_offset_global?: number | null }).start_offset_global ?? null,
          end_offset: (row as { end_offset_global?: number | null }).end_offset_global ?? null,
        })),
      });
    }

    logger.info("Validator lifecycle summary before insert", {
      jobId,
      chunkId: chunk.id,
      runKey,
      resolvedFindingsCount: resolvedFindings.length,
      storedEvidencePassedCount,
      storedEvidenceBypassedCount,
      storedEvidenceDroppedCount,
      eventConsistencyPassedCount,
      eventConsistencyBypassedCount,
      eventConsistencyDroppedCount,
      passSpecificPassedCount,
      passSpecificBypassedCount,
      passSpecificDroppedCount,
      canonicalModelPassedCount,
      explicitScenePassedCount,
      rowsCount: rows.length,
      validatorAuditMode,
      rejectionsByRule: Object.fromEntries([...validatorRejectionCounts.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))),
      postCanonicalEvidenceDroppedCount,
      canonicalModelMismatchDroppedCount,
      explicitSceneMismatchDroppedCount,
    });

    // Log first row shape for debugging column mismatch
    /* logger.info("AI findings upsert payload sample", ... ); */

    await persistJudgeDiagnostic({
      diagnostic_kind: "chunk_final",
      job_id: jobId,
      chunk_id: chunk.id,
      prompt_hash: "",
      router_candidates: routerOutputJson,
      raw_judge_response: "",
      parsed_judge_response: null,
      parsed_finding_count: 0,
      grounded_finding_count: groundedFindingCount,
      validated_finding_count: validatedFindingCount,
      final_chunk_finding_count: rows.length,
      final_chunk_findings: rows,
      parser_validation_errors: validatorWarnings.length > 0 ? { validator_warnings: validatorWarnings } : null,
    });

    logger.info("[DEBUG] Persistence stage preparing", {
      jobId,
      chunkId: chunk.id,
      runKey,
      resolvedFindingsCount: resolvedFindings.length,
      normalizedTextLength: normalizedText?.length ?? 0,
    });
    logger.info("AI findings upsert starting", {
      jobId,
      chunkId: chunk.id,
      runKey,
      postCanonicalEvidenceDroppedCount,
      canonicalModelMismatchDroppedCount,
      explicitSceneMismatchDroppedCount,
      rows: rows.length,
      timeoutMs: CRITICAL_DB_TIMEOUT_MS,
    });
    const missingTitleArCount = multiPassResult?.passResults.reduce(
      (total, pass) => total + (pass.missingTitleCount ?? 0),
      0,
    ) ?? 0;
    logger.info("Title pipeline telemetry", {
      jobId,
      chunkId: chunk.id,
      missingTitleAr: missingTitleArCount,
      canonicalTitleGenerated: canonicalTitleGeneratedCount,
      reviewerTitleUsed: reviewerTitleUsedCount,
      rejectedForMissingTitle: missingTitleArCount,
    });
      const { data, error } = await withOperationTimeout<{
        data: Array<{ id: string; lineage_id?: string | null; finding_uuid?: string | null; article_id: number; atom_id: string | null; confidence?: number | null }> | null;
        error: { message: string } | null;
      }>(
        "Upsert analysis_findings",
        CRITICAL_DB_TIMEOUT_MS,
        supabase
          .from("analysis_findings")
          .upsert(rows, { onConflict: "job_id,evidence_hash", ignoreDuplicates: true })
          .select("id,lineage_id,finding_uuid,article_id,atom_id,confidence")
    );
    throwIfAborted(signal);

    logger.info("[DEBUG] Persistence stage complete", {
      jobId,
      chunkId: chunk.id,
      runKey,
      attempted: rows.length,
      inserted: data?.length ?? 0,
      dropped: rows.length - (data?.length ?? 0),
    });
    logger.info("AI findings upsert result", {
      jobId, chunkId: chunk.id,
      attempted: rows.length,
      inserted: data?.length ?? 0,
      error: error ?? null,
    });
    recordTelemetryFromFindings({
      jobId,
      stageName: "persistence",
      inputCount: rows.length,
      findings: data ?? [],
    });
    if (config.DEBUG_TRACE_FINDING_PIPELINE) {
      logger.info("TRACE INSERTED FINDING IDS", {
        jobId,
        chunkId: chunk.id,
        insertedCount: data?.length ?? 0,
        insertedFindingIds: (data ?? []).map((row) => row.id),
      });
    }

    if (config.DEBUG_TRACE_FINDING_PIPELINE) {
      const insertedIdByLineage = new Map(
        (data ?? []).map((row) => [row.lineage_id ?? "", row.id] as const)
      );
      traceFindingPipelineStage({
        jobId,
        chunkId: chunk.id,
        stageName: "Database Insert Result",
        functionName: "analysis_findings upsert",
        stageChunkIndex: chunk.chunk_index,
        snapshots: rows.slice(0, 5).map((row) => {
          const lineageId = (row as { lineage_id?: string | null }).lineage_id ?? "";
          return {
            traceId: lineageId,
            findingUuid: (row as { finding_uuid?: string | null }).finding_uuid ?? null,
            reviewerArticleId: (row as { article_id?: number | null }).article_id ?? null,
            passName: null,
            eventId: getRowEventId(row),
            pageNumber: (row as { page_number?: number | null }).page_number ?? null,
            title_ar: (row as { title_ar?: string | null }).title_ar ?? null,
            description_ar: (row as { description_ar?: string | null }).description_ar ?? null,
            rationale_ar: (row as { rationale_ar?: string | null }).rationale_ar ?? null,
            canonical_atom: (row as { canonical_atom?: string | null }).canonical_atom ?? null,
            article_id: (row as { article_id?: number | null }).article_id ?? null,
            claimedArticleId: (row as { article_id?: number | null }).article_id ?? null,
            severity: (row as { severity?: string | null }).severity ?? null,
            confidence: (row as { confidence?: number | null }).confidence ?? null,
            evidence_snippet: (row as { evidence_snippet?: string | null }).evidence_snippet ?? null,
            quote: (row as { evidence_snippet?: string | null }).evidence_snippet ?? null,
            start_offset: (row as { start_offset_global?: number | null }).start_offset_global ?? null,
            end_offset: (row as { end_offset_global?: number | null }).end_offset_global ?? null,
            insertedFindingId: insertedIdByLineage.get(lineageId) ?? null,
          };
        }),
      });
    }

    if (error) {
      logger.error("AI findings upsert FAILED", {
        jobId, chunkId: chunk.id,
        error,
        errorMessage: error.message,
        errorDetails: error.details,
        errorHint: error.hint,
        errorCode: error.code,
      });
      await setChunkFailed(chunk.id, `AI findings upsert failed: ${error.message}`);
      throw new Error(`AI findings upsert failed: ${error.message}`);
    } else {
      await persistLineageEvents(
        rows.map((row) =>
          buildLineageEvent(row, {
            jobId,
            chunkId: chunk.id,
            stageName: "aggregation",
            passName: (row as { location?: { v3?: { detection_pass?: string | null } } }).location?.v3?.detection_pass ?? null,
            metadata: { inserted: true },
          })
        )
      );
      await upsertFindingPolicyLinks(
        (data ?? []).map((r: { id: string; article_id: number; atom_id: string | null; confidence?: number | null }) => ({
          id: (r as { id: string }).id,
          article_id: (r as { article_id: number }).article_id,
          atom_id: (r as { atom_id: string | null }).atom_id,
          confidence: (r as { confidence?: number | null }).confidence ?? 0,
        }))
      );
    }
    logger.info("Chunk insert timings", {
      jobId,
      chunkId: chunk.id,
      runKey,
      insertDurationMs: Date.now() - insertStartedAt,
      totalChunkDurationMs: Date.now() - chunkStartedAt,
      jobResourcesDurationMs,
    });
  } else {
    await persistJudgeDiagnostic({
      diagnostic_kind: "chunk_final",
      job_id: jobId,
      chunk_id: chunk.id,
      prompt_hash: "",
      router_candidates: routerOutputJson,
      raw_judge_response: "",
      parsed_judge_response: null,
      parsed_finding_count: 0,
      grounded_finding_count: groundedFindingCount,
      validated_finding_count: validatedFindingCount,
      final_chunk_finding_count: 0,
      final_chunk_findings: [],
    });
    logger.info("No AI findings to insert for chunk", { jobId, chunkId: chunk.id, runKey });
  }

  throwIfAborted(signal);
  if (await isJobCancelled(jobId)) {
    await setChunkFailed(chunk.id, "Cancelled by user");
    throw new JobCancelledError();
  }
  await setChunkDone(chunk.id);
  await incrementJobProgress(jobId);
  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineSummary(jobId, chunk.id);
  }
  logger.info("Chunk processed", {
    chunkId: chunk.id,
    runKey,
    findings: persistedFindings.length,
    totalChunkDurationMs: Date.now() - chunkStartedAt,
  });
}
