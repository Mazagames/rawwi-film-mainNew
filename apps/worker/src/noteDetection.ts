import { createHash, randomUUID } from "crypto";
import { classifyProviderFailure, generateStructuredCompletion } from "./aiClient.js";
import { config, getAIProviderPolicy } from "./config.js";
import { canonicalStringify } from "./canonicalJson.js";
import { extractJsonFromText, noteOutputSchema, noteSchema, type NoteItem, type NoteOutput } from "./schemas.js";
import { logger } from "./logger.js";
import { getNoteDefinitions, validateArticleNoteReviewerCoverage, type NoteReviewerDefinition } from "./notePromptPack.js";
import type { ReviewerKind } from "./notePromptPack.js";
import { parseJudgeWithRepair } from "./openai.js";
import type { JudgeFinding } from "./schemas.js";
import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import {
  countNoteCategoriesFromArray,
  getRenderedNoteTabLabel,
  logNoteCategoryMapping,
  logNotePipelineStage,
  normalizeNoteCategoryKey,
} from "./notePipelineTelemetry.js";
import { AdaptiveReviewerScheduler } from "./reviewerLifecycle.js";
import { ChunkExecutionController } from "./chunkExecutionController.js";

type OpenAiCallOptions = {
  signal?: AbortSignal;
};

export type NotePassResult = {
  passName: string;
  reviewerId: string;
  category: string;
  notes: NoteItem[];
  duration: number;
  provider: "openai" | "gemini";
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestStartedAt: string | null;
  responseReceivedAt: string | null;
  rawResponseLength: number;
  generatedNoteCount: number;
  parsedNoteCount: number;
  acceptedCount: number;
  rejectedCount: number;
  parseValidationError: string | null;
  status: "success" | "empty" | "parse_error" | "timeout" | "retry_exhausted" | "provider_error" | "rate_limited" | "no_credits" | "model_not_found" | "auth_error" | "config_error";
  fallbackProvider: "openai" | null;
  skipped?: boolean;
  reason?: string;
};

export type NoteDetectionResult = {
  notes: NoteItem[];
  passResults: NotePassResult[];
  executedPassCount: number;
  skippedPassCount: number;
  totalDuration: number;
};

export type ReviewerPackResult = {
  notes: NoteItem[];
  violationCandidates: JudgeFinding[];
  passResults: NotePassResult[];
  executedPassCount: number;
  skippedPassCount: number;
  totalDuration: number;
};

export type NoteInsertRow = {
  job_id: string;
  reviewer: string;
  category: string;
  title: string;
  description: string;
  snippet: string;
  event_id: number;
  confidence: number;
  status: string;
  included_in_report: boolean;
};

const NOTE_REPAIR_SYSTEM = `You fix broken JSON. Return only valid JSON, no markdown, no explanation.
Expected shape: { "notes": [ { "reviewer", "category", "title", "description", "paragraph", "quote", "event_id", "confidence", "status", "included_in_report" } ] }
The response must be a single JSON object.
Do not include any prose. Return JSON only.`;

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function buildStructuredEventsPayload(events: StructuredEvent[]): string {
  return canonicalStringify(events);
}

function buildLineNumberedChunk(chunkText: string): string {
  return chunkText
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(4, "0")}: ${line}`)
    .join("\n");
}

export function buildNoteSystemPrompt(definition: NoteReviewerDefinition): string {
  if (definition.kind === "violation") {
    return `${definition.prompt}

Return ONLY valid JSON with a findings array.
Each finding must contain article_id, event_id, title_ar, rationale_ar, evidence_snippet, and confidence.
Evaluate every StructuredEvent independently and preserve exact event_id and evidence_snippet values.`;
  }
  return `${definition.prompt}

You are a notes reviewer.
Notes are not violations.
Do not generate findings[].
Do not classify GCAM violations.
Do not change article ownership.
Return ONLY valid JSON.
The response must be a single JSON object.
The response must contain the word JSON.

**CRITICAL EVALUATION RULES:**
1. You MUST evaluate EVERY SINGLE structured event provided. Do not stop after finding one match.
2. Score each event against the category definition. Retain ALL events that are clearly relevant.
3. If an event represents a strong, explicit scene (e.g., a full police raid, explicit visuals), do not ignore it in favor of a weak lexical mention in another event.
4. For every genuinely relevant event, produce a separate note. Missing a clearly relevant note is worse than producing multiple legitimate notes. Do not force one note per category.

**EVIDENCE RULES:**
- Use only structured events for event_id and subject selection.
- Use the screenplay chunk ONLY to retrieve the exact verbatim paragraph and quote for the selected event.
- Never use an AI-generated event summary as note evidence.
- Each note must contain category, title, description, paragraph, quote, event_id, and confidence.
- paragraph must be the surrounding 5-10 screenplay lines.
- quote must be the shortest verbatim excerpt from the screenplay that supports the note.
- These fields are evidence copied from the screenplay/event source. They MUST remain verbatim in the original language of the supplied screenplay/event. Do not translate, rewrite, summarize, paraphrase, normalize, correct, or reinterpret them.
- The 4-digit prefixes (e.g., 0109:) in the Screenplay Chunk are INTERNAL REVIEW IDS and MUST NEVER appear in the quote, paragraph, evidence_snippet, title, or description. Evidence must contain the original screenplay text only.
- When extracting quote or paragraph that spans multiple lines, preserve the original spaces and line breaks. Do not merge or concatenate words across line boundaries.

If any required field cannot be produced, omit that note.
If no note exists, return {"notes":[]}.`;
}

async function callNotesOpenAI(args: {
  definition: NoteReviewerDefinition;
  events: StructuredEvent[];
  chunkText: string;
  temperature: number;
  seed: number;
  signal?: AbortSignal;
  provider: "openai" | "gemini";
  timeoutMs: number;
}): Promise<{
  rawResponse: string;
  responseId: string | null;
  responseTimestamp: string;
  finishReason: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  renderedSystemPrompt: string;
  renderedUserPrompt: string;
}> {
  const systemPrompt = buildNoteSystemPrompt(args.definition);
  const userPrompt = `# Structured Events\n${buildStructuredEventsPayload(args.events)}\n\n# Screenplay Chunk\n${buildLineNumberedChunk(args.chunkText)}\n\nReturn JSON only.`;

  logger.info("[DEBUG] Note reviewer request prepared", {
    reviewer: args.definition.id,
    category: args.definition.category,
    model: args.provider === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
    provider: args.provider,
    eventCount: args.events.length,
    chunkLength: args.chunkText.length,
  });

  const response = await generateStructuredCompletion({
    model: args.provider === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
    systemPrompt: systemPrompt,
    userPrompt: userPrompt,
    temperature: args.temperature,
    seed: args.seed,
    maxTokens: config.AI_PROVIDER === "gemini" ? 16384 : 8192,
    timeoutMs: args.timeoutMs,
    providerOverride: args.provider,
    signal: args.signal,
  });

  return {
    rawResponse: response.content,
    responseId: response.responseId,
    responseTimestamp: response.responseTimestamp,
    finishReason: response.finishReason,
    usage: response.usage,
    renderedSystemPrompt: systemPrompt,
    renderedUserPrompt: userPrompt,
  };
}

async function repairNotesJson(model: string, brokenContent: string, context: string, signal?: AbortSignal): Promise<string> {
  const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : model, // Fallback if a specific judge model was passed
    systemPrompt: NOTE_REPAIR_SYSTEM,
    userPrompt: `Context: ${context}\n\nBroken JSON:\n${brokenContent.slice(0, 8000)}\n\nReturn the corrected JSON only.`,
    temperature: 0,
    seed: 12345,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal,
  });
  return resp.content;
}

function parseNotesOutput(raw: string): NoteOutput {
  const json = extractJsonFromText(raw);
  const parsed = JSON.parse(json) as unknown;
  return noteOutputSchema.parse(parsed);
}

async function parseNotesWithRepair(
  raw: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ notes: unknown[]; repaired: boolean; parseError: string | null }> {
  try {
    const parsed = parseNotesOutput(raw);
    return { notes: parsed.notes, repaired: false, parseError: null };
  } catch (error) {
    const repairRaw = await repairNotesJson(model, raw, "Note reviewer output JSON", signal);
    try {
      const repaired = parseNotesOutput(repairRaw);
      return { notes: repaired.notes, repaired: true, parseError: error instanceof Error ? error.message : String(error) };
    } catch (repairError) {
      logger.warn("Note reviewer JSON repair failed", {
        error: error instanceof Error ? error.message : String(error),
        repairError: repairError instanceof Error ? repairError.message : String(repairError),
      });
      return { notes: [], repaired: true, parseError: error instanceof Error ? error.message : String(error) };
    }
  }
}

function summarizeValidationIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function validateNoteCandidate(candidate: unknown): { note: NoteItem | null; rejectionReason: string | null } {
  const parsed = noteSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      note: null,
      rejectionReason: summarizeValidationIssues(parsed.error.issues),
    };
  }
  return {
    note: parsed.data,
    rejectionReason: null,
  };
}

function normalizeEvidenceField(text: string | null | undefined): string {
  if (!text) return "";
  // Strip internal line IDs (e.g. 0109:) ONLY when they occur at the beginning of a line.
  return text.replace(/^\s*\d{4}:\s?/gm, "").trim();
}

function classifyReviewerError(error: unknown): NotePassResult["status"] {
  const kind = classifyProviderFailure(error);
  if (kind === "no_credits" || kind === "model_not_found" || kind === "auth_error" || kind === "config_error") return kind;
  if (kind === "timeout") return "timeout";
  if (kind === "rate_limited") return "rate_limited";
  if (kind === "provider_busy") return "retry_exhausted";
  return "provider_error";
}

export function isTransientProviderError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  return candidate?.status === 429 || candidate?.status === 503 || candidate?.code === 429 || candidate?.code === 503
    || /(?:\b429\b|\b503\b|rate.?limit|too many requests|service unavailable|unavailable)/i.test(message);
}

export async function retryTransientProviderFailure<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; budgetMs?: number; delay?: (milliseconds: number) => Promise<void>; scheduler?: AdaptiveReviewerScheduler } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientProviderError(error) || attempt === maxAttempts || (options.budgetMs !== undefined && Date.now() - startedAt >= options.budgetMs)) {
        throw error;
      }
      const computedBackoffMs = options.scheduler?.getNextRetryDelayMs(attempt) ?? (2 ** (attempt - 1) * 1000);
      const remainingMs = options.budgetMs === undefined ? computedBackoffMs : options.budgetMs - (Date.now() - startedAt);
      if (remainingMs <= 0) throw error;
      const jitteredBackoffMs = Math.max(1_000, Math.min(computedBackoffMs, remainingMs) + Math.floor(Math.random() * 1_000));
      await delay(jitteredBackoffMs);
    }
  }
}

export async function runNotesProviderWithFallback<T>(args: {
  primaryProvider: "openai" | "gemini";
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  retryBudgetMs?: number;
  onFallback?: () => void;
  scheduler?: AdaptiveReviewerScheduler;
}): Promise<T> {
  try {
    return await retryTransientProviderFailure(args.primary, { budgetMs: args.retryBudgetMs, scheduler: args.scheduler });
  } catch (error) {
    if (args.primaryProvider !== "gemini" || !isTransientProviderError(error)) {
      throw error;
    }
    if (!getAIProviderPolicy().fallbackAllowed) {
      throw error;
    }
    logger.warn("Note reviewer primary provider exhausted transient retries; falling back", {
      primaryProvider: args.primaryProvider,
      fallbackProvider: "openai",
      error: error instanceof Error ? error.message : String(error),
    });
    args.onFallback?.();
    return args.fallback();
  }
}
export async function runWithBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker()));
  return results;
}

async function runWithAdaptiveConcurrency<T, R>(
  items: T[],
  scheduler: AdaptiveReviewerScheduler,
  worker: (item: T, index: number) => Promise<R>,
  options?: { chunkController?: ChunkExecutionController },
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let activeCount = 0;
  const launchNext = async (): Promise<void> => {
    while (nextIndex < items.length) {
      options?.chunkController?.tick();
      if (options?.chunkController && !options.chunkController.shouldLaunchNewReviewers()) {
        return;
      }
      if (options?.chunkController && activeCount >= 1) {
        return;
      }
      if (activeCount >= scheduler.getCurrentConcurrency()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        continue;
      }
      const index = nextIndex++;
      activeCount += 1;
      const workerPromise = Promise.resolve().then(() => worker(items[index], index));
      void workerPromise.then((value) => {
        results[index] = value;
      }).catch(() => {
        // Preserve the slot and let the queue continue; the caller handles the error.
      }).finally(() => {
        activeCount -= 1;
        void launchNext();
      });
      if (nextIndex < items.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      }
    }
  };

  await launchNext();
  while (activeCount > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return results;
}

export function normalizeNote(note: NoteItem, reviewerId: string): NoteItem | null {
  const emittedCategory = String(note.category ?? "").trim();
  if (!emittedCategory) {
    return null;
  }
  const resolvedCategory = normalizeNoteCategoryKey(emittedCategory);
  if (!resolvedCategory) {
    return null;
  }

  const rawSnippet = typeof note.snippet === "string" && note.snippet.trim() ? note.snippet : note.paragraph;

  return {
    ...note,
    reviewer: note.reviewer ?? reviewerId,
    category: resolvedCategory,
    title: normalizeText(note.title),
    description: normalizeText(note.description),
    paragraph: normalizeEvidenceField(note.paragraph),
    quote: normalizeEvidenceField(note.quote),
    snippet: normalizeEvidenceField(rawSnippet),
    status: note.status ?? "new",
    included_in_report: typeof note.included_in_report === "boolean" ? note.included_in_report : true,
    confidence: typeof note.confidence === "number" ? Math.max(0, Math.min(1, note.confidence)) : 0.7,
  };
}

export function toNoteInsertRow(jobId: string, note: NoteItem): NoteInsertRow {
  return {
    job_id: jobId,
    reviewer: note.reviewer ?? "",
    category: note.category,
    title: note.title,
    description: note.description,
    snippet: typeof note.snippet === "string" && note.snippet.trim() ? note.snippet : note.paragraph,
    event_id: note.event_id,
    confidence: typeof note.confidence === "number" ? note.confidence : 0.7,
    status: note.status ?? "new",
    included_in_report: typeof note.included_in_report === "boolean" ? note.included_in_report : true,
  };
}

export function toNoteInsertRows(jobId: string, notes: NoteItem[]): NoteInsertRow[] {
  return notes.map((note) => toNoteInsertRow(jobId, note));
}

function reviewerArticleId(definition: NoteReviewerDefinition): number | null {
  const match = /^article_(\d{2})_/.exec(definition.id);
  return match ? Number(match[1]) : null;
}

export async function runReviewerPack(
  chunkText: string,
  eventUnderstanding: EventUnderstandingPassResult | null,
  jobConfig: { temperature: number; seed: number },
  options: {
    jobId: string;
    chunkId: string;
    chunkIndex?: number;
    signal?: AbortSignal;
    definitions?: NoteReviewerDefinition[];
    reviewerResponse?: (definition: NoteReviewerDefinition, signal?: AbortSignal) => Promise<string>;
    chunkController?: ChunkExecutionController;
  },
): Promise<ReviewerPackResult> {
  const startedAt = Date.now();
  const definitions = options.definitions ?? getNoteDefinitions();
  validateArticleNoteReviewerCoverage(definitions);
  const events = eventUnderstanding?.events ?? [];
  const scheduler = new AdaptiveReviewerScheduler({
    baseConcurrency: config.NOTE_REVIEWER_CONCURRENCY,
    minConcurrency: 1,
    recoveryDelayMs: 5_000,
    baseDelayMs: 2_000,
  });
  const chunkController = options.chunkController ?? null;
  if (chunkController) {
    chunkController.attachScheduler(scheduler);
    chunkController.start();
  }
  const results = await runWithAdaptiveConcurrency(
    definitions,
    scheduler,
    async (definition) => {
      const passStartedAt = Date.now();
      const requestStartedAt = new Date(passStartedAt).toISOString();
      if (chunkController) {
        chunkController.tick();
        if (!chunkController.shouldLaunchNewReviewers()) {
          return { definition, notes: [], findings: [], response: null, duration: Date.now() - passStartedAt, error: "chunk_degraded", diagnostics: {
            requestStartedAt,
            responseReceivedAt: null,
            generatedNoteCount: 0,
            parsedNoteCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            parseValidationError: "chunk soft deadline reached",
            fallbackProvider: null,
            status: "timeout" as NotePassResult["status"],
          } };
        }
        chunkController.markReviewerStarted();
      }
      let responseReceivedAt: string | null = null;
      let fallbackProvider: "openai" | null = null;
      let rawResponseLength = 0;
      const provider = config.AI_PROVIDER;
      const model = provider === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL;
      logger.info("NOTE_REVIEWER_START", {
        jobId: options.jobId,
        chunkId: options.chunkId,
        chunkIndex: options.chunkIndex ?? null,
        reviewerId: definition.id,
        category: definition.category,
        kind: definition.kind,
        destination: definition.destination,
        articleId: reviewerArticleId(definition),
        promptFile: definition.filename,
        promptHash: createHash("sha256").update(definition.prompt).digest("hex"),
      });
      try {
        const { response, parsed } = await runNotesProviderWithFallback({
          primaryProvider: provider,
          retryBudgetMs: config.NOTE_REVIEWER_RETRY_BUDGET_MS,
          onFallback: () => { fallbackProvider = getAIProviderPolicy().fallbackProviders[0] ?? null; },
          scheduler,
          primary: async () => {
            const response = options.reviewerResponse ? null : await callNotesOpenAI({
              definition,
              events,
              chunkText,
              temperature: jobConfig.temperature,
              seed: jobConfig.seed,
              signal: options.signal,
              provider,
              timeoutMs: config.NOTE_REVIEWER_REQUEST_TIMEOUT_MS,
            });
            const rawResponse = options.reviewerResponse ? await options.reviewerResponse(definition, options.signal) : response!.rawResponse;
            responseReceivedAt = new Date().toISOString();
            rawResponseLength = rawResponse.length;
            return { response, parsed: definition.kind === "note"
              ? await parseNotesWithRepair(rawResponse, config.OPENAI_JUDGE_MODEL, options.signal)
              : await parseJudgeWithRepair(rawResponse, model, { signal: options.signal, passName: definition.id }) };
          },
          fallback: async () => {
            const fallbackProvider = getAIProviderPolicy().fallbackProviders[0];
            if (!fallbackProvider) throw new Error("No provider fallback is allowed by the active provider policy");
            const response = await callNotesOpenAI({ definition, events, chunkText, temperature: jobConfig.temperature, seed: jobConfig.seed, signal: options.signal, provider: fallbackProvider, timeoutMs: config.NOTE_REVIEWER_REQUEST_TIMEOUT_MS });
            responseReceivedAt = new Date().toISOString();
            rawResponseLength = response.rawResponse.length;
            return { response, parsed: definition.kind === "note"
              ? await parseNotesWithRepair(response.rawResponse, config.OPENAI_JUDGE_MODEL, options.signal)
              : await parseJudgeWithRepair(response.rawResponse, config.OPENAI_JUDGE_MODEL, { signal: options.signal, finishReason: response.finishReason, passName: definition.id }) };
          },
        });
        if (definition.kind === "note") {
          const notes: NoteItem[] = [];
          let rejectedCount = 0;
          const rejectionReasons: string[] = [];
          for (const candidate of parsed.notes ?? []) {
            const validated = validateNoteCandidate(candidate);
            const normalized = validated.note ? normalizeNote(validated.note, definition.id) : null;
            if (normalized) {
              notes.push(normalized);
            } else {
              rejectedCount += 1;
              rejectionReasons.push(validated.rejectionReason ?? "unknown note category");
            }
          }
          const reviewerStatus: NotePassResult["status"] = parsed.parseError && notes.length === 0 ? "parse_error" : (notes.length > 0 ? "success" : "empty");
          logger.info("Note reviewer completion diagnostics", {
            jobId: options.jobId,
            chunkId: options.chunkId,
            chunkIndex: options.chunkIndex ?? null,
            reviewer: definition.id,
            provider,
            model,
            requestStartedAt,
            responseReceivedAt,
            rawResponseLength,
            generatedNoteCount: parsed.notes?.length ?? 0,
            parsedNoteCount: parsed.notes?.length ?? 0,
            acceptedCount: notes.length,
            rejectedCount,
            parseValidationError: parsed.parseError ?? (rejectionReasons.length > 0 ? rejectionReasons.join("; ") : null),
            fallbackProvider,
            status: reviewerStatus,
          });
          logger.info("NOTE_REVIEWER_PROVIDER_PARSE_RESULT", {
            jobId: options.jobId,
            chunkId: options.chunkId,
            chunkIndex: options.chunkIndex ?? null,
            reviewerId: definition.id,
            category: definition.category,
            responseReceived: responseReceivedAt !== null,
            responseLength: rawResponseLength,
            parsed: true,
            generatedCount: parsed.notes?.length ?? 0,
            acceptedCount: notes.length,
            error: parsed.parseError,
            fallbackProvider,
            status: reviewerStatus,
          });
          logger.info("NOTE_REVIEWER_END", {
            jobId: options.jobId,
            chunkId: options.chunkId,
            reviewerId: definition.id,
            category: definition.category,
            generatedCount: parsed.notes?.length ?? 0,
            acceptedCount: notes.length,
            passedToPersistenceCount: notes.length,
            durationMs: Date.now() - passStartedAt,
            status: reviewerStatus,
            articleId: reviewerArticleId(definition),
            promptFile: definition.filename,
            promptHash: createHash("sha256").update(definition.prompt).digest("hex"),
          });
          if (chunkController) {
            chunkController.noteProviderSuccess();
            chunkController.markReviewerCompleted();
          }
          scheduler.onSuccess();
          return { definition, notes, findings: [], response, duration: Date.now() - passStartedAt, diagnostics: {
            requestStartedAt,
            responseReceivedAt,
            rawResponseLength,
            generatedNoteCount: parsed.notes?.length ?? 0,
            parsedNoteCount: parsed.notes?.length ?? 0,
            acceptedCount: notes.length,
            rejectedCount,
            parseValidationError: parsed.parseError ?? (rejectionReasons.length > 0 ? rejectionReasons.join("; ") : null),
            fallbackProvider,
            status: reviewerStatus,
          } };
        }
        const articleId = reviewerArticleId(definition);
        const findings = (parsed as { findings?: JudgeFinding[] }).findings ?? [];
        if (chunkController) {
          chunkController.noteProviderSuccess();
          chunkController.markReviewerCompleted();
        }
        scheduler.onSuccess();
        return {
          definition,
          notes: [],
          findings: findings.map((finding) => ({
            ...finding,
            article_id: articleId ?? finding.article_id,
            detection_pass: definition.id,
          })),
          response,
          duration: Date.now() - passStartedAt,
        };
      } catch (error) {
        if (chunkController) {
          chunkController.markReviewerFailed();
        }
        if (isTransientProviderError(error)) {
          if (chunkController) {
            chunkController.noteProviderFailure(error);
          }
          scheduler.onTransientFailure({ status: 503, message: error instanceof Error ? error.message : String(error) });
        }
        const reviewerStatus = classifyReviewerError(error);
        logger.warn("Reviewer pack entry failed", { jobId: options.jobId, chunkId: options.chunkId, reviewer: definition.id, error: error instanceof Error ? error.message : String(error), status: reviewerStatus });
        logger.warn("Note reviewer completion diagnostics", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          chunkIndex: options.chunkIndex ?? null,
          reviewer: definition.id,
          provider,
          model,
          requestStartedAt,
          responseReceivedAt,
          rawResponseLength: 0,
          generatedNoteCount: 0,
          parsedNoteCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          parseValidationError: error instanceof Error ? error.message : String(error),
          fallbackProvider,
          status: reviewerStatus,
        });
        logger.warn("NOTE_REVIEWER_PROVIDER_PARSE_RESULT", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          chunkIndex: options.chunkIndex ?? null,
          reviewerId: definition.id,
          category: definition.category,
          responseReceived: responseReceivedAt !== null,
          responseLength: rawResponseLength,
          parsed: false,
          generatedCount: 0,
          acceptedCount: 0,
          error: error instanceof Error ? error.message : String(error),
          fallbackProvider,
          status: reviewerStatus,
        });
        logger.warn("NOTE_REVIEWER_END", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          chunkIndex: options.chunkIndex ?? null,
          reviewerId: definition.id,
          category: definition.category,
          generatedCount: 0,
          acceptedCount: 0,
          passedToPersistenceCount: 0,
          durationMs: Date.now() - passStartedAt,
          status: reviewerStatus,
          articleId: reviewerArticleId(definition),
          promptFile: definition.filename,
          promptHash: createHash("sha256").update(definition.prompt).digest("hex"),
        });
        return { definition, notes: [], findings: [], response: null, duration: Date.now() - passStartedAt, error: String(error), diagnostics: {
          requestStartedAt,
          responseReceivedAt,
          generatedNoteCount: 0,
          parsedNoteCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          parseValidationError: error instanceof Error ? error.message : String(error),
          fallbackProvider,
          status: reviewerStatus,
        } };
      }
  }, { chunkController });
  const notes = results.flatMap((result) => result.notes);
  const violationCandidates = results.flatMap((result) => result.findings);
  const dedup = <T extends { event_id?: number | null; category?: string; article_id?: number | null; evidence_snippet?: string }>(items: T[]) => {
    const seen = new Map<string, T>();
    for (const item of items) {
      const key = `${item.event_id ?? item.evidence_snippet ?? ""}|${item.category ?? item.article_id ?? ""}`;
      if (!seen.has(key)) seen.set(key, item);
    }
    return [...seen.values()];
  };
  const passResults = results.map((result) => ({
    passName: result.definition.id,
    reviewerId: result.definition.id,
    category: result.definition.category,
    notes: result.notes,
    duration: result.duration,
    provider: config.AI_PROVIDER,
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
    promptTokens: result.response?.usage?.prompt_tokens ?? null,
    completionTokens: result.response?.usage?.completion_tokens ?? null,
    totalTokens: result.response?.usage?.total_tokens ?? null,
    requestStartedAt: result.diagnostics?.requestStartedAt ?? null,
    responseReceivedAt: result.diagnostics?.responseReceivedAt ?? null,
    rawResponseLength: result.diagnostics?.rawResponseLength ?? result.response?.rawResponse.length ?? 0,
    generatedNoteCount: result.diagnostics?.generatedNoteCount ?? 0,
    parsedNoteCount: result.diagnostics?.parsedNoteCount ?? 0,
    acceptedCount: result.diagnostics?.acceptedCount ?? result.notes.length,
    rejectedCount: result.diagnostics?.rejectedCount ?? 0,
    parseValidationError: result.diagnostics?.parseValidationError ?? result.error ?? null,
    fallbackProvider: result.diagnostics?.fallbackProvider ?? null,
    status: result.diagnostics?.status ?? (result.notes.length > 0 ? "success" : "empty"),
    ...(result.error ? { reason: "failed", skipped: false } : {}),
  } satisfies NotePassResult));
  const deduplicatedNotes = dedup(notes);
  logger.info("Notes deduplication diagnostics", {
    jobId: options.jobId,
    chunkId: options.chunkId,
    inputNoteCount: notes.length,
    deduplicatedNoteCount: deduplicatedNotes.length,
    deduplicationDroppedCount: notes.length - deduplicatedNotes.length,
  });
  return {
    notes: deduplicatedNotes,
    violationCandidates: dedup(violationCandidates),
    passResults,
    executedPassCount: results.length,
    skippedPassCount: 0,
    totalDuration: Date.now() - startedAt,
  };
}

export async function runNotesDetection(
  chunkText: string,
  eventUnderstanding: EventUnderstandingPassResult | null,
  jobConfig: { temperature: number; seed: number },
  options: {
    jobId: string;
    chunkId: string;
    signal?: AbortSignal;
  },
): Promise<NoteDetectionResult> {
  const sharedResult = await runReviewerPack(chunkText, eventUnderstanding, jobConfig, {
    ...options,
    definitions: getNoteDefinitions().filter((definition) => definition.kind === "note"),
  });
  const permanentFailure = sharedResult.passResults.find((pass) =>
    pass.status === "no_credits" || pass.status === "model_not_found" || pass.status === "auth_error" || pass.status === "config_error",
  );
  if (permanentFailure) {
    const error = Object.assign(new Error(`Permanent provider failure in ${permanentFailure.reviewerId}: ${permanentFailure.status}`), {
      providerFailure: permanentFailure.status,
    });
    throw error;
  }
  return {
    notes: sharedResult.notes,
    passResults: sharedResult.passResults,
    executedPassCount: sharedResult.executedPassCount,
    skippedPassCount: sharedResult.skippedPassCount,
    totalDuration: sharedResult.totalDuration,
  };

  /* Legacy implementation retained below for comparison during the controlled migration. */
  let noteDefinitions: NoteReviewerDefinition[] = [];
  try {
    noteDefinitions = getNoteDefinitions();
  } catch (error) {
    logger.warn("Notes pipeline disabled for chunk because note pack failed to load", {
      jobId: options.jobId,
      chunkId: options.chunkId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      notes: [],
      passResults: [],
      executedPassCount: 0,
      skippedPassCount: 0,
      totalDuration: 0,
    };
  }
  const events = eventUnderstanding?.events ?? [];
  const startedAt = Date.now();
  const passResults: NotePassResult[] = [];
  const allNotes: NoteItem[] = [];

  const concurrentResults = await runWithBoundedConcurrency(
    noteDefinitions,
    config.NOTE_REVIEWER_CONCURRENCY,
    async (definition) => {
      const passStartedAt = Date.now();
      try {
      const primaryProvider = config.AI_PROVIDER;
      const { response, parsed } = await runNotesProviderWithFallback({
        primaryProvider,
        retryBudgetMs: config.NOTE_REVIEWER_RETRY_BUDGET_MS,
        primary: async () => {
        const response = await callNotesOpenAI({
          definition,
          events,
          chunkText,
          temperature: jobConfig.temperature,
          seed: jobConfig.seed,
          signal: options.signal,
          provider: primaryProvider,
          timeoutMs: Math.min(
            config.JUDGE_TIMEOUT_MS,
            Math.max(1_000, Math.floor(config.NOTE_REVIEWER_RETRY_BUDGET_MS / 3)),
          ),
        });
        const parsed = await parseNotesWithRepair(response.rawResponse, config.OPENAI_JUDGE_MODEL, options.signal);
        return { response, parsed };
        },
        fallback: async () => {
          const response = await callNotesOpenAI({
            definition,
            events,
            chunkText,
            temperature: jobConfig.temperature,
            seed: jobConfig.seed,
            signal: options.signal,
            provider: "openai",
            timeoutMs: config.JUDGE_TIMEOUT_MS,
          });
          const parsed = await parseNotesWithRepair(response.rawResponse, config.OPENAI_JUDGE_MODEL, options.signal);
          return { response, parsed };
        },
      });
      const generatedNotes = Array.isArray(parsed.notes) ? parsed.notes : [];
      const normalizedNotes: NoteItem[] = [];
      const noteTelemetry = {
        generated: generatedNotes.length,
        accepted: 0,
        rejected: 0,
        rejectionReasons: [] as string[],
      };
      for (const [noteIndex, candidate] of generatedNotes.entries()) {
        logger.info("Note reviewer note generated", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          reviewer: definition.id,
          category: definition.category,
          noteIndex,
          generated: true,
        });
        const validated = validateNoteCandidate(candidate);
        if (!validated.note) {
          noteTelemetry.rejected += 1;
          if (validated.rejectionReason) {
            noteTelemetry.rejectionReasons.push(validated.rejectionReason);
          }
          logger.warn("Note reviewer note rejected", {
            jobId: options.jobId,
            chunkId: options.chunkId,
            reviewer: definition.id,
            category: definition.category,
            noteIndex,
            generated: true,
            accepted: false,
            rejected: true,
            rejectionReason: validated.rejectionReason ?? "invalid note schema",
          });
          continue;
        }
        const normalized = normalizeNote(validated.note, definition.id);
        if (!normalized) {
          noteTelemetry.rejected += 1;
          const emittedCategory = String(validated.note.category ?? "").trim();
          logNoteCategoryMapping({
            reviewerName: definition.id,
            persistedCategory: emittedCategory || definition.category,
            renderedTab: null,
            jobId: options.jobId,
            chunkId: options.chunkId,
            eventId: typeof validated.note.event_id === "number" ? validated.note.event_id : null,
            status: "rejected",
            reason: "unknown note category",
          });
          logger.warn("Note reviewer emitted unknown category; note rejected", {
            jobId: options.jobId,
            chunkId: options.chunkId,
            reviewer: definition.id,
            category: emittedCategory || null,
            fallbackCategory: definition.category,
            eventId: typeof validated.note.event_id === "number" ? validated.note.event_id : null,
            generated: true,
            accepted: false,
            rejected: true,
            rejectionReason: "unknown note category",
          });
          continue;
        }
        noteTelemetry.accepted += 1;
        logNoteCategoryMapping({
          reviewerName: definition.id,
          persistedCategory: normalized.category,
          renderedTab: getRenderedNoteTabLabel(normalized.category),
          jobId: options.jobId,
          chunkId: options.chunkId,
          eventId: normalized.event_id,
          status: "accepted",
        });
        logger.info("Note reviewer note accepted", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          reviewer: definition.id,
          category: definition.category,
          noteIndex,
          generated: true,
          accepted: true,
          rejected: false,
        });
        normalizedNotes.push(normalized);
      }
      logger.info("Note reviewer completed", {
        jobId: options.jobId,
        chunkId: options.chunkId,
        reviewer: definition.id,
        category: definition.category,
        noteCount: normalizedNotes.length,
        repaired: parsed.repaired,
        parseError: parsed.parseError ?? null,
        finishReason: response.finishReason,
      });
      logger.info("Note reviewer validation summary", {
        jobId: options.jobId,
        chunkId: options.chunkId,
        reviewer: definition.id,
        category: definition.category,
        generated: noteTelemetry.generated,
        accepted: noteTelemetry.accepted,
        rejected: noteTelemetry.rejected,
        rejectionReasons: noteTelemetry.rejectionReasons,
      });
      const passResult: NotePassResult = {
        passName: definition.id,
        reviewerId: definition.id,
        category: definition.category,
        notes: normalizedNotes,
        duration: Date.now() - passStartedAt,
        model: config.OPENAI_JUDGE_MODEL,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      };
      return {
        passResult,
        normalizedNotes,
      };
    } catch (error) {
      logger.warn("Note reviewer failed", {
        jobId: options.jobId,
        chunkId: options.chunkId,
        reviewer: definition.id,
        category: definition.category,
        error: error instanceof Error ? error.message : String(error),
      });
      const passResult: NotePassResult = {
        passName: definition.id,
        reviewerId: definition.id,
        category: definition.category,
        notes: [],
        duration: Date.now() - passStartedAt,
        model: config.OPENAI_JUDGE_MODEL,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        skipped: false,
        reason: "failed",
      };
      return {
        passResult,
        normalizedNotes: [],
      };
    }
    },
  );

  for (const result of concurrentResults) {
    if (result.passResult) {
      passResults.push(result.passResult);
    }
    if (result.normalizedNotes && result.normalizedNotes.length > 0) {
      allNotes.push(...result.normalizedNotes);
    }
  }

  logNotePipelineStage({
    jobId: options.jobId,
    chunkId: options.chunkId,
    stageLabel: "Note Runner",
    actionLabel: "Generated",
    noteCounts: countNoteCategoriesFromArray(allNotes),
  });

  // Deterministic Deduplication Phase
  // 1. Group by event_id + category, OR normalized quote + category
  const dedupGroups = new Map<string, NoteItem[]>();
  for (const note of allNotes) {
    const key =
      typeof note.event_id === "number"
        ? `event_${note.event_id}_${note.category}`
        : `quote_${normalizeText(note.quote ?? "")}_${note.category}`;
    if (!dedupGroups.has(key)) {
      dedupGroups.set(key, []);
    }
    dedupGroups.get(key)!.push(note);
  }

  const deduplicatedNotes: NoteItem[] = [];
  const droppedNotes = [];

  for (const [key, group] of dedupGroups.entries()) {
    if (group.length === 1) {
      deduplicatedNotes.push(group[0]);
    } else {
      // Sort by confidence descending, keep the first
      group.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      deduplicatedNotes.push(group[0]);
      // Log dropped notes
      for (let i = 1; i < group.length; i++) {
        droppedNotes.push(group[i]);
        logger.info("Note dropped by deterministic deduplication", {
          jobId: options.jobId,
          chunkId: options.chunkId,
          category: group[i].category,
          eventId: group[i].event_id,
          reason: "Duplicate note for the same event/quote",
        });
      }
    }
  }

  return {
    notes: deduplicatedNotes,
    passResults,
    executedPassCount: passResults.filter((p) => !p.skipped).length,
    skippedPassCount: passResults.filter((p) => p.skipped).length,
    totalDuration: Date.now() - startedAt,
  };
}
