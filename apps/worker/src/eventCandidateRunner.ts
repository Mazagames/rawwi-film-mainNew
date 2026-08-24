import { config } from "./config.js";
import { enforceDeterministicOwnership } from "./deterministicOwnership.js";
import { groundFindingEvidenceToChunk } from "./evidenceGrounding.js";
import { runFinalAdjudicator } from "./finalAdjudicator.js";
import { renderBoundedStructuredEventContext, type EventUnderstandingPassResult } from "./eventUnderstanding.js";
import { getScriptStandardArticle, type GCAMArticle } from "./gcam.js";
import { callJudgeRaw, parseJudgeWithRepair } from "./openai.js";
import { extractRawFindingCount } from "./judgeDiagnostics.js";
import { getV5ReviewerDefinitions } from "./v5PromptPack.js";
import { runNotesProviderWithFallback, runWithBoundedConcurrency } from "./noteDetection.js";
import type { JudgeFinding } from "./schemas.js";
import type { PassResult } from "./multiPassJudge.js";
import { logger } from "./logger.js";

const NOTES_ONLY_ARTICLES = new Set([11, 13, 21]);

export type EventCandidateRunnerResult = {
  findings: JudgeFinding[];
  passResults: PassResult[];
  totalDuration: number;
  executedPassCount: number;
  skippedPassCount: number;
  eventUnderstanding: EventUnderstandingPassResult;
  rawCandidateCount: number;
  parsedCandidateCount: number;
  groundedCandidateCount: number;
  ownershipSurvivorCount: number;
  finalAdjudicatorSurvivorCount: number;
  groundedCandidates: JudgeFinding[];
  ownershipSurvivors: JudgeFinding[];
};

type ReviewerResult = {
  passResult: PassResult;
  groundedFindings: JudgeFinding[];
  rawCandidateCount: number;
  parsedCandidateCount: number;
};

function getViolationReviewers() {
  return getV5ReviewerDefinitions().filter((reviewer) => !NOTES_ONLY_ARTICLES.has(reviewer.articleNumber));
}

async function runReviewer(args: {
  reviewer: ReturnType<typeof getViolationReviewers>[number];
  eventUnderstanding: EventUnderstandingPassResult;
  chunkText: string;
  signal?: AbortSignal;
  reviewerResponse?: (articleNumber: number) => Promise<string>;
  notesStyleProviderResolution?: boolean;
}): Promise<ReviewerResult> {
  const startedAt = Date.now();
  const article = getScriptStandardArticle(args.reviewer.articleNumber) as GCAMArticle;
  const passName = `v5_article_${String(args.reviewer.articleNumber).padStart(2, "0")}`;
  const systemPrompt = args.reviewer.prompt;
  const userPrompt = renderBoundedStructuredEventContext(args.eventUnderstanding);
  const primaryProvider = args.notesStyleProviderResolution ? config.AI_PROVIDER : config.V5_VIOLATION_JUDGE_PROVIDER;
  const model = args.notesStyleProviderResolution
    ? (primaryProvider === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL)
    : config.V5_VIOLATION_JUDGE_MODEL;

  const invoke = async (provider: "openai" | "gemini") => {
    const response = args.reviewerResponse ? null : await callJudgeRaw(
      args.chunkText,
      [article],
      0,
      args.chunkText.length,
      { judge_model: model, temperature: 0, seed: 12345 },
      systemPrompt,
      null,
      {
        signal: args.signal,
        userContentOverride: userPrompt,
        isV5EventFirst: true,
        providerOverride: provider,
        modelOverride: provider === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
        passName,
      },
    );
    const rawResponse = args.reviewerResponse
      ? await args.reviewerResponse(args.reviewer.articleNumber)
      : response!.raw_judge_response;
    const parsed = await parseJudgeWithRepair(rawResponse, model, {
      signal: args.signal,
      finishReason: response?.finish_reason ?? null,
      passName,
    });
    const findings = parsed.findings.filter((finding) => finding.article_id === args.reviewer.articleNumber);
    const groundedFindings = findings.flatMap((finding) => {
      const grounded = groundFindingEvidenceToChunk(finding, args.chunkText, args.eventUnderstanding.events);
      return grounded.grounded ? [grounded.finding] : [];
    });
    logger.info(args.notesStyleProviderResolution ? "VIOLATION NOTE-STYLE RESPONSE RECEIVED" : "Violation candidate runner reviewer completed", {
      passName,
      provider,
      model,
      rawResponseLength: rawResponse.length,
      rawCandidateCount: parsed.findings.length,
      parsedCandidateCount: findings.length,
      groundedCandidateCount: groundedFindings.length,
      durationMs: Date.now() - startedAt,
    });
    return { findings, groundedFindings, rawCandidateCount: extractRawFindingCount(rawResponse) ?? 0 };
  };

  try {
    if (args.notesStyleProviderResolution) {
      logger.info("VIOLATION NOTE-STYLE REQUEST STARTED", {
        passName,
        provider: primaryProvider,
        model,
        actualClientPath: primaryProvider === "gemini" ? "@google/genai models.generateContent" : "openai.chat.completions.create",
      });
    }
    const result = await runNotesProviderWithFallback({
      primaryProvider,
      primary: () => invoke(primaryProvider),
      fallback: () => invoke("openai"),
      retryBudgetMs: config.NOTE_REVIEWER_RETRY_BUDGET_MS,
    });
    return {
      groundedFindings: result.groundedFindings,
      rawCandidateCount: result.rawCandidateCount,
      parsedCandidateCount: result.findings.length,
      passResult: {
        passName,
        findings: result.groundedFindings,
        duration: Date.now() - startedAt,
        model,
      },
    };
  } catch (error) {
    logger.error("Violation candidate runner reviewer failed", {
      passName,
      provider: primaryProvider,
      model,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      groundedFindings: [],
      rawCandidateCount: 0,
      parsedCandidateCount: 0,
      passResult: {
        passName,
        findings: [],
        duration: Date.now() - startedAt,
        model,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function runEventCandidateRunner(args: {
  chunkText: string;
  eventUnderstanding: EventUnderstandingPassResult;
  signal?: AbortSignal;
  reviewerResponse?: (articleNumber: number) => Promise<string>;
  finalAdjudicator?: typeof runFinalAdjudicator;
  articleNumbers?: number[];
  notesStyleProviderResolution?: boolean;
  experimentLabel?: string;
}): Promise<EventCandidateRunnerResult> {
  const startedAt = Date.now();
  const allowedArticles = args.articleNumbers ? new Set(args.articleNumbers) : null;
  const reviewers = getViolationReviewers().filter((reviewer) => !allowedArticles || allowedArticles.has(reviewer.articleNumber));
  const concurrency = parseInt(process.env.WORKER_JUDGE_CONCURRENCY ?? "4", 10) || 4;
  if (args.experimentLabel) {
    logger.info("VIOLATION NOTE-STYLE TEST START", {
      experiment: args.experimentLabel,
      articlePassCount: reviewers.length,
      provider: args.notesStyleProviderResolution ? config.AI_PROVIDER : config.V5_VIOLATION_JUDGE_PROVIDER,
      model: args.notesStyleProviderResolution
        ? (config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL)
        : config.V5_VIOLATION_JUDGE_MODEL,
      actualClientPath: args.notesStyleProviderResolution
        ? (config.AI_PROVIDER === "gemini" ? "@google/genai models.generateContent" : "openai.chat.completions.create")
        : "callJudgeRaw provider dispatch",
    });
  }
  const results = await runWithBoundedConcurrency(
    reviewers,
    concurrency,
    (reviewer) => runReviewer({
      reviewer,
      eventUnderstanding: args.eventUnderstanding,
      chunkText: args.chunkText,
      signal: args.signal,
      reviewerResponse: args.reviewerResponse,
      notesStyleProviderResolution: args.notesStyleProviderResolution,
    }),
  );
  const groundedCandidates = results.flatMap((result) => result.groundedFindings);
  const ownership = enforceDeterministicOwnership(groundedCandidates, args.eventUnderstanding.events, args.chunkText);
  const rows = ownership.finalFindings.map((finding) => ({
    ...finding,
    finding_uuid: finding.finding_uuid ?? `event-candidate-${finding.event_id}-${finding.article_id}`,
    location: {
      ...finding.location,
      v3: { ...(finding.location?.v3 ?? {}), event_id: finding.event_id },
    },
  }));
  const adjudicator = args.finalAdjudicator ?? runFinalAdjudicator;
  const finalFindings = await adjudicator(rows, args.eventUnderstanding.events, args.chunkText);
  const rawCandidates = results.reduce((total, result) => total + result.rawCandidateCount, 0);
  const parsedCandidates = results.reduce((total, result) => total + result.parsedCandidateCount, 0);
  logger.info("Violation candidate engine: event_candidate_runner", {
    provider: args.notesStyleProviderResolution ? config.AI_PROVIDER : config.V5_VIOLATION_JUDGE_PROVIDER,
    model: args.notesStyleProviderResolution
      ? (config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL)
      : config.V5_VIOLATION_JUDGE_MODEL,
    articlePassCount: reviewers.length,
    rawCandidates,
    parsedCandidates,
    groundedCandidates: groundedCandidates.length,
    ownershipSurvivors: ownership.finalFindings.length,
    finalAdjudicatorSurvivors: finalFindings.length,
  });
  if (args.experimentLabel) {
    logger.info("VIOLATION NOTE-STYLE TEST COMPLETE", {
      experiment: args.experimentLabel,
      rawCandidateCount: rawCandidates,
      parsedCandidateCount: parsedCandidates,
      groundedCandidateCount: groundedCandidates.length,
      ownershipSurvivorCount: ownership.finalFindings.length,
      finalAdjudicatorSurvivorCount: finalFindings.length,
      finalReturnedFindingCount: finalFindings.length,
      zeroStage: rawCandidates === 0 ? "raw" : parsedCandidates === 0 ? "parsed" : groundedCandidates.length === 0 ? "grounding" : ownership.finalFindings.length === 0 ? "ownership" : finalFindings.length === 0 ? "final_adjudicator" : null,
    });
  }
  return {
    findings: finalFindings,
    passResults: results.map((result) => result.passResult),
    totalDuration: Date.now() - startedAt,
    executedPassCount: results.length,
    skippedPassCount: 0,
    eventUnderstanding: args.eventUnderstanding,
    rawCandidateCount: rawCandidates,
    parsedCandidateCount: parsedCandidates,
    groundedCandidateCount: groundedCandidates.length,
    ownershipSurvivorCount: ownership.finalFindings.length,
    finalAdjudicatorSurvivorCount: finalFindings.length,
    groundedCandidates,
    ownershipSurvivors: ownership.finalFindings,
  };
}

export function getEventCandidateRunnerArticlePassCount(): number {
  return getViolationReviewers().length;
}
