import { randomUUID } from "crypto";
import { z } from "zod";
import {
  generateStructuredCompletion,
  type AICompletionRequest,
  type AICompletionResponse,
} from "./aiClient.js";
import { config, getAIProviderPolicy, resolveModelForRole } from "./config.js";
import { ChunkExecutionController } from "./chunkExecutionController.js";
import { AdaptiveReviewerScheduler } from "./reviewerLifecycle.js";
import { canonicalStringify } from "./canonicalJson.js";
import { extractJsonFromText } from "./schemas.js";
import { logger } from "./logger.js";

export type StructuredEvent = {
  event_id: number;
  event_summary: string;
  actor: string;
  target: string;
  action: string;
  intent: string;
  consequence: string;
  quote: string;
  start_offset: number | null;
  end_offset: number | null;
  dominant_meaning: string;
};

export type EventUnderstandingPassResult = {
  chunk_start: number;
  chunk_end: number;
  event_count: number;
  events: StructuredEvent[];
  original_event_count?: number;
  original_events?: StructuredEvent[];
  verification?: EventUnderstandingVerificationResult | null;
};

export type EventUnderstandingVerificationResult = {
  status: "ok" | "corrected";
  events: StructuredEvent[];
  original_event_count: number;
  final_event_count: number;
  raw_response: string;
  response_id: string | null;
  response_timestamp: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  finish_reason: string | null;
};

export const EVENT_UNDERSTANDING_SYSTEM_PROMPT = `You are a screenplay understanding engine.

You are NOT a GCAM reviewer.
You are NOT evaluating policy.
You are NOT detecting violations.
You are NOT classifying content.

Your only responsibility is to understand narrative events in the screenplay.

Your output will later be reviewed by specialized GCAM reviewers.

Your responsibility is only to produce an objective and accurate understanding of what happens.

This layer is domain-neutral. If the same screenplay were analyzed for copyright, education, or storytelling instead of GCAM compliance, the extracted events should be identical.

These fields are evidence copied from the screenplay/event source. They MUST remain verbatim in the original language of the supplied screenplay/event. Do not translate, rewrite, summarize, paraphrase, normalize, correct, or reinterpret them.`;

const EVENT_UNDERSTANDING_EVENT_SCHEMA = z.object({
  event_id: z.preprocess(toNumber, z.number().int().min(1)),
  event_summary: z.preprocess(
    (value) => toStringValue(value)?.trim() ?? "",
    z.string().min(1),
  ),
  actor: z.preprocess(toStringValue, z.string()),
  target: z.preprocess(toStringValue, z.string()),
  action: z.preprocess(toStringValue, z.string()),
  intent: z.preprocess(toStringValue, z.string()),
  consequence: z.preprocess(toStringValue, z.string()),
  quote: z.preprocess(toStringValue, z.string()),
  start_offset: z.preprocess((val) => (val == null ? null : toNumber(val)), z.number().int().min(0).nullable()),
  end_offset: z.preprocess((val) => (val == null ? null : toNumber(val)), z.number().int().min(0).nullable()),
  dominant_meaning: z.preprocess(toStringValue, z.string()),
});

const EVENT_UNDERSTANDING_OUTPUT_SCHEMA = z.object({
  chunk_start: z
    .preprocess(toNumber, z.number().int().min(0))
    .optional()
    .nullable()
    .transform((value) => (typeof value === "number" ? value : 0)),
  chunk_end: z
    .preprocess(toNumber, z.number().int().min(0))
    .optional()
    .nullable()
    .transform((value) => (typeof value === "number" ? value : 0)),
  event_count: z
    .preprocess(toNumber, z.number().int().min(0))
    .optional()
    .nullable()
    .transform((value) => (typeof value === "number" ? value : 0)),
  events: z.array(EVENT_UNDERSTANDING_EVENT_SCHEMA),
});

const EVENT_UNDERSTANDING_VERIFICATION_CORRECTION_SCHEMA = z.object({
  action: z.enum(["add", "update", "delete"]),
  event_id: z.number().int().min(1),
  event: EVENT_UNDERSTANDING_EVENT_SCHEMA.optional(),
});

const EVENT_UNDERSTANDING_VERIFICATION_OUTPUT_SCHEMA = z.union([
  z.object({ status: z.literal("ok") }),
  z.object({
    status: z.literal("corrected"),
    corrections: z.array(EVENT_UNDERSTANDING_VERIFICATION_CORRECTION_SCHEMA).min(1),
  }),
  z.object({
    status: z.literal("corrected"),
    events: z.array(EVENT_UNDERSTANDING_EVENT_SCHEMA).min(1),
  }),
  z
    .object({
      events: z.array(EVENT_UNDERSTANDING_EVENT_SCHEMA).min(1),
    })
    .transform((value) => ({
      status: "corrected" as const,
      events: value.events,
    })),
]);

const SOFT_EVENT_COUNT_WARNING_THRESHOLD = 20;

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function buildEventUnderstandingUserPrompt(
  chunkText: string,
  chunkStart: number,
  chunkEnd: number,
): string {
  return `Sequential Cognitive Protocol (V5.7)

The current architecture is correct.

Do NOT redesign the architecture.

Do NOT modify:

JSON schema
Event Understanding API
Event renderer
Reviewer pipeline
Reviewer markdown files
Validator
Persistence
Aggregation
Database
Downstream contracts

The only objective is to improve how the Understanding Layer thinks before producing the existing JSON.

The output contract must remain 100% identical.

Goal

The current prompt asks the model to solve many reasoning tasks simultaneously.

Instead, follow the same reasoning order that a skilled screenplay analyst naturally follows.

The model must never try to determine meaning, intent, or consequence before it has first understood the event itself.

The Understanding Layer is not a classifier.

It is not a reviewer.

It is not a policy engine.

Its only job is to convert screenplay prose into objective narrative events.

Phase 1 — Read

Read the entire screenplay chunk from beginning to end.

Do not extract events while reading.

Do not generate output while reading.

Your only goal during this phase is to understand what happens across the entire chunk.

Ignore policy.

Ignore violations.

Ignore articles.

Ignore classification.

Simply understand the narrative.

Phase 2 — Segment the Narrative

After understanding the whole chunk, divide it into independent narrative events.

An event represents one continuous interaction.

Do not create events for:

scene headings
location headings
transitions
camera directions
atmosphere
narration
environmental description
emotions by themselves
reactions by themselves

unless they introduce a new observable action.

A continuous conversation normally remains one event.

A continuous argument normally remains one event.

A continuous interrogation normally remains one event.

A continuous fight normally remains one event.

Only create a new event when the dominant interaction itself changes.

Phase 3 — Build the Event Skeleton

For each event, determine only these four fields:

actor
action
target
quote

Do not determine anything else yet.

The action must always describe an observable action.

Use a verb or short verb phrase.

Examples:

Hits
Threatens
Orders
Publishes
Confesses
Leaks
Refuses
Steals

Never describe interpretations.

Never describe categories.

Never describe violations.

The quote must be the shortest verbatim quotation that objectively proves the event.
These fields are evidence copied from the screenplay/event source. They MUST remain verbatim in the original language of the supplied screenplay/event. Do not translate, rewrite, summarize, paraphrase, normalize, correct, or reinterpret them.

Phase 4 — Enrich the Event

Only after the event skeleton is complete should the model enrich it.

Generate:

event_summary
intent
consequence
dominant_meaning

event_summary

Describe the event objectively.

Prefer the pattern:

Actor → Observable Action → Target.

Keep it under approximately 20 words.

Do not mention:

GCAM
policy
legality
morality
violations
article numbers
risk
intent

Only populate this field if the screenplay explicitly states or unmistakably expresses the actor's intent.

If the intent requires inference,

leave it empty.

consequence

Only populate this field if the screenplay explicitly states or clearly shows the immediate consequence.

Otherwise leave it empty.

dominant_meaning

Describe the event itself.

Not your opinion about the event.

Good:

Physical assault
Verbal threat
Family argument
Information disclosure
Political speech
Drug transaction

Bad:

Illegal
Dangerous
Offensive
Article 12
Violation

Phase 5 — Internal Verification

Before producing JSON, internally verify:

Every event is one continuous interaction.
No unrelated actions were merged.
No continuous interaction was split unnecessarily.
Every quote is verbatim.
Every quote directly supports its event.
Every action is observable.
Every summary is objective.
Intent is explicit.
Consequence is explicit.
Dominant meaning describes the event itself.

If any field is unsupported,

leave it empty.

Never invent information.

Never complete missing information from assumptions.

Phase 6 — Return JSON

Return only the existing JSON schema.

Do not change:

field names
ordering
structure
downstream contracts

Only the reasoning process changes.

The output format remains identical.

Guiding Philosophy

The Understanding Layer must behave like an experienced screenplay analyst.

Its reasoning order should always be:

Understand the screenplay.
Divide it into narrative events.
Determine who did what to whom.
Only then derive objective descriptive information about each completed event.
Return structured data.

The Understanding Layer must never think like a reviewer.

It must never evaluate policy.

It must never classify violations.

It must never anticipate what later reviewers will conclude.

Its only responsibility is to produce the most faithful, objective representation of the screenplay's narrative events.

One recommendation I would add

When uncertain between two reasonable interpretations, prefer the less specific but objectively observable interpretation. The Understanding Layer should optimize for factual accuracy rather than completeness. It is better to leave a field empty than to infer information that is not explicitly supported by the screenplay.

Screenplay chunk:
${chunkText}

Return only structured JSON using this exact schema:
{
  "chunk_start": 0,
  "chunk_end": 0,
  "event_count": 0,
  "events": [
    {
      "event_id": 1,
      "event_summary": "Father threatens child with physical violence.",
      "actor": "",
      "target": "",
      "action": "",
      "intent": "",
      "consequence": "",
      "quote": "",
      "start_offset": 0,
      "end_offset": 0,
      "dominant_meaning": ""
    }
  ]
}`;
}

export function renderStructuredEventContext(
  result: EventUnderstandingPassResult,
): string {
  const payload = canonicalStringify({
    understanding_layer: "semantic_event_understanding",
    one_event_one_finding: true,
    domain_neutrality: true,
    chunk_start: result.chunk_start,
    chunk_end: result.chunk_end,
    event_count: result.event_count,
    events: result.events,
  });

  return [
    "The screenplay has already been read and understood.",
    "You are NOT responsible for understanding the screenplay.",
    "You must trust the structured events below.",
    "Evaluate ONLY those events.",
    "Do not rediscover events.",
    "Do not reinterpret dialogue.",
    "Do not infer new actions.",
    "Do not merge events.",
    "Do not split events.",
    payload,
  ].join("\n\n");
}

export function renderBoundedStructuredEventContext(
  result: EventUnderstandingPassResult,
): string {
  const boundedEvents = result.events.map((event, index) => {
    const prevEvent = index > 0 ? result.events[index - 1] : null;
    const nextEvent = index < result.events.length - 1 ? result.events[index + 1] : null;
    return {
      event_id: event.event_id,
      scene_heading: event.event_summary ?? "Unknown",
      actor: event.actor ?? "Unknown",
      target: event.target ?? "Unknown",
      action: event.action ?? "Unknown",
      quote: event.quote ?? "",
      previous_event_quote: prevEvent?.quote ?? null,
      next_event_quote: nextEvent?.quote ?? null
    };
  });

  const payload = canonicalStringify({
    understanding_layer: "semantic_event_understanding",
    one_event_one_finding: true,
    domain_neutrality: true,
    event_count: result.event_count,
    events: boundedEvents,
  });

  return [
    "The screenplay has already been read and understood.",
    "You are NOT responsible for understanding the screenplay.",
    "You must trust the structured events below.",
    "Evaluate ONLY those events.",
    "Do not rediscover events.",
    "Do not reinterpret dialogue.",
    "Do not infer new actions.",
    "Do not merge events.",
    "Do not split events.",
    payload,
  ].join("\n\n");
}

export const EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT = `You are a screenplay understanding verifier.

You are NOT a GCAM reviewer.
You are NOT classifying policy.
You are NOT deciding violations.

Your only job is to verify whether the structured events accurately describe the screenplay chunk.

You must compare the screenplay chunk with the structured events and correct only objective understanding mistakes.

Do not invent new policy language.
Do not classify content.
Do not assign articles.
Do not add GCAM reasoning.

Return only valid JSON.
The response must be a single JSON object.
Do not include markdown.
Do not include explanations.
Do not include prose.
Output only JSON matching the required schema.`;

export function buildEventUnderstandingVerifierUserPrompt(
  result: EventUnderstandingPassResult,
): string {
  return `Compare the structured events with the understanding criteria.

Check only these questions:
- Did any event merge unrelated actions?
- Did any event split one continuous interaction?
- Was any meaningful event omitted?
- Are event summaries objective?

Do not add policy language.
Do not classify anything.
Do not invent new events unless the structured events are incomplete or objectively wrong.

Structured events:
${canonicalStringify({
  chunk_start: result.chunk_start,
  chunk_end: result.chunk_end,
  event_count: result.event_count,
  events: result.events,
})}

Return only valid JSON matching one of these shapes:
{ "status": "ok" }

or if you must make corrections, return a list of specific operations (do NOT return the full event list):
{
  "status": "corrected",
  "corrections": [
    { "action": "update", "event_id": 12, "event": { ... full corrected event ... } },
    { "action": "delete", "event_id": 13 },
    { "action": "add", "event_id": 999, "event": { ... new event ... } }
  ]
}`;
}

function compactSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForSearch(text: string): string {
  return compactSpace(text).toLowerCase();
}

export function groundEventQuoteToChunk(
  quote: string | null | undefined,
  chunkText: string,
  hintStart: number | null
): { start: number | null; end: number | null } {
  if (!quote || quote.length < 3) return { start: null, end: null };

  const exactIdx = chunkText.indexOf(quote);
  if (exactIdx !== -1 && chunkText.indexOf(quote, exactIdx + 1) === -1) {
    return { start: exactIdx, end: exactIdx + quote.length };
  }

  const rawOccurrences: number[] = [];
  let rawPos = 0;
  while (true) {
    const idx = chunkText.indexOf(quote, rawPos);
    if (idx === -1) break;
    rawOccurrences.push(idx);
    rawPos = idx + 1;
  }

  if (rawOccurrences.length === 1) {
    return { start: rawOccurrences[0], end: rawOccurrences[0] + quote.length };
  }

  if (rawOccurrences.length > 1 && hintStart != null) {
    let bestDist = Infinity;
    let bestStart: number | null = null;
    for (const start of rawOccurrences) {
      const dist = Math.abs(start - hintStart);
      if (dist < bestDist) {
        bestDist = dist;
        bestStart = start;
      }
    }
    if (bestStart !== null && bestDist <= 500) {
      return { start: bestStart, end: bestStart + quote.length };
    }
  }

  return { start: null, end: null };
}

export function parseEventUnderstandingOutput(
  raw: string,
  chunkStart: number,
  chunkEnd: number,
  chunkText?: string,
): EventUnderstandingPassResult {
  const json = extractJsonFromText(raw);
  const parsed = JSON.parse(json) as unknown;
  const output = EVENT_UNDERSTANDING_OUTPUT_SCHEMA.parse(parsed);
  const events = output.events.map((event) => {
    let finalStart = event.start_offset;
    let finalEnd = event.end_offset;

    if (chunkText) {
      const grounded = groundEventQuoteToChunk(event.quote, chunkText, event.start_offset);
      finalStart = grounded.start;
      finalEnd = grounded.end;
    }

    return {
      event_id: event.event_id,
      event_summary: event.event_summary,
      actor: event.actor,
      target: event.target,
      action: event.action,
      intent: event.intent,
      consequence: event.consequence,
      quote: event.quote,
      start_offset: finalStart,
      end_offset: finalEnd,
      dominant_meaning: event.dominant_meaning,
    };
  });

  return {
    chunk_start: chunkStart,
    chunk_end: chunkEnd,
    event_count: events.length,
    events,
  };
}

export function parseEventUnderstandingVerificationOutput(
  raw: string,
  chunkText?: string,
  originalEvents?: StructuredEvent[],
): {
  status: "ok" | "corrected";
  events: StructuredEvent[];
} {
  const json = extractJsonFromText(raw);
  const parsed = JSON.parse(json) as unknown;
  const output = EVENT_UNDERSTANDING_VERIFICATION_OUTPUT_SCHEMA.parse(parsed);

  if ("status" in output && output.status === "ok") {
    return { status: "ok", events: [] };
  }

  if ("status" in output && output.status === "corrected") {
    let finalEvents = originalEvents ? [...originalEvents] : [];

    if ("corrections" in output && output.corrections) {
      for (const correction of output.corrections) {
        if (correction.action === "delete") {
          finalEvents = finalEvents.filter(e => e.event_id !== correction.event_id);
        } else if (correction.action === "update" && correction.event) {
          const idx = finalEvents.findIndex(e => e.event_id === correction.event_id);
          if (idx !== -1) finalEvents[idx] = correction.event as StructuredEvent;
        } else if (correction.action === "add" && correction.event) {
          finalEvents.push(correction.event as StructuredEvent);
        }
      }
    } else if ("events" in output && output.events) {
      finalEvents = output.events as StructuredEvent[];
    }

    finalEvents = finalEvents.map((event) => {
      let finalStart = event.start_offset;
      let finalEnd = event.end_offset;

      if (chunkText) {
        const grounded = groundEventQuoteToChunk(event.quote, chunkText, event.start_offset);
        finalStart = grounded.start;
        finalEnd = grounded.end;
      }

      return {
        event_id: event.event_id,
        event_summary: event.event_summary,
        actor: event.actor,
        target: event.target,
        action: event.action,
        intent: event.intent,
        consequence: event.consequence,
        quote: event.quote,
        start_offset: finalStart,
        end_offset: finalEnd,
        dominant_meaning: event.dominant_meaning,
      };
    });
    return { status: "corrected", events: finalEvents };
  }

  return { status: "ok", events: [] };
}

function isEventUnderstandingTransientError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  return candidate?.status === 429 || candidate?.status === 503 || candidate?.status === 504 || candidate?.code === 429 || candidate?.code === 503 || candidate?.code === 504
    || /(?:\b429\b|\b503\b|\b504\b|rate.?limit|too many requests|service unavailable|temporarily unavailable|overloaded|timed out|timeout|unavailable)/i.test(message);
}

function delayForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runEventUnderstandingRequestWithLifecycle(options: {
  prompt: string;
  systemPrompt: string;
  model: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  chunkController?: ChunkExecutionController;
  providerOverride?: "openai" | "gemini";
  fallbackModel?: string | null;
  request: (context: { model: string; provider: "openai" | "gemini"; timeoutMs: number; signal?: AbortSignal }) => Promise<AICompletionResponse>;
  maxAttempts?: number;
}): Promise<AICompletionResponse & { resolvedModel: string }> {
  const policy = getAIProviderPolicy();
  const maxAttempts = Math.max(1, options.maxAttempts ?? config.AI_OVERLOAD_MAX_RETRIES);
  const totalAttempts = maxAttempts + (policy.fallbackAllowed && options.fallbackModel ? 1 : 0);
  const timeoutMs = options.timeoutMs ?? config.JUDGE_TIMEOUT_MS;
  let provider = options.providerOverride ?? policy.primaryProvider;
  let model = options.model;
  let attempt = 0;
  let fallbackAttempted = false;
  let schedulerAttached = false;

  if (options.chunkController) {
    const scheduler = new AdaptiveReviewerScheduler({
      baseConcurrency: 1,
      minConcurrency: 1,
      recoveryDelayMs: 5_000,
      baseDelayMs: 2_000,
    });
    options.chunkController.attachScheduler(scheduler);
    schedulerAttached = true;
  }

  while (attempt < totalAttempts) {
    attempt += 1;
    if (options.chunkController) {
      options.chunkController.tick();
      if (!options.chunkController.shouldLaunchNewReviewers()) {
        const blockedReason = options.chunkController.getState().hardDeadlineReached ? "chunk hard deadline reached" : "chunk soft deadline reached";
        throw new Error(blockedReason);
      }
      options.chunkController.markReviewerStarted();
    }

    try {
      logger.info("EVENT_UNDERSTANDING_PROVIDER_ATTEMPT", {
        provider,
        model,
        attempt,
        error: null,
        fallback: provider !== (options.providerOverride ?? policy.primaryProvider),
      });

      const response = await options.request({
        model,
        provider,
        timeoutMs,
        signal: options.signal,
      });

      if (options.chunkController) {
        options.chunkController.noteProviderSuccess();
        options.chunkController.markReviewerCompleted();
      }
      return { ...response, resolvedModel: model };
    } catch (error) {
      const isTransient = isEventUnderstandingTransientError(error);
      const isBlockedByDeadline = options.chunkController?.getState().hardDeadlineReached || options.signal?.aborted;

      if (options.chunkController) {
        if (isBlockedByDeadline) {
          options.chunkController.markReviewerAborted();
          throw error;
        }
        options.chunkController.markReviewerFailed();
        if (isTransient) {
          options.chunkController.noteProviderFailure(error);
        }
      }

      logger.warn("EVENT_UNDERSTANDING_PROVIDER_ATTEMPT", {
        provider,
        model,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        fallback: provider !== (options.providerOverride ?? policy.primaryProvider),
      });

      if (isTransient && attempt < totalAttempts && !options.signal?.aborted) {
        if (!fallbackAttempted && provider === "gemini" && policy.fallbackAllowed && options.fallbackModel) {
          provider = "openai";
          model = options.fallbackModel;
          fallbackAttempted = true;
          logger.warn("EVENT_UNDERSTANDING_PROVIDER_FALLBACK", {
            provider,
            model,
            attempt,
            reason: "primary provider exhausted transient retries",
          });
          await delayForMs(1_000 + Math.floor(Math.random() * 500));
          continue;
        }
        if (attempt < totalAttempts) {
          const remainingMs = options.chunkController?.getRemainingTimeMs() ?? Number.POSITIVE_INFINITY;
          const backoffMs = Math.min(2_000 * attempt, 8_000) + Math.floor(Math.random() * 1_000);
          if (remainingMs <= 100) {
            throw new Error("chunk hard deadline reached");
          }
          await delayForMs(Math.min(backoffMs, Math.max(1, remainingMs - 100)));
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error("Max attempts reached");
}

async function callEventUnderstandingOpenAI(
  chunkText: string,
  chunkStart: number,
  chunkEnd: number,
  options?: {
    signal?: AbortSignal;
    chunkController?: ChunkExecutionController;
  },
): Promise<{
  rawResponse: string;
  finishReason: string | null;
  usage: AICompletionResponse["usage"];
}> {
  const userPrompt = buildEventUnderstandingUserPrompt(
    chunkText,
    chunkStart,
    chunkEnd,
  );

  const resolvedModel = resolveModelForRole("router", config.OPENAI_JUDGE_MODEL).model;

  logger.info("[DEBUG] Event understanding request prepared", {
    model: resolvedModel,
    chunkStart,
    chunkEnd,
    chunkLength: chunkText.length,
  });

  const response = await runEventUnderstandingRequestWithLifecycle({
    prompt: userPrompt,
    systemPrompt: EVENT_UNDERSTANDING_SYSTEM_PROMPT,
    model: resolvedModel,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options?.signal,
    chunkController: options?.chunkController,
    providerOverride: getAIProviderPolicy().primaryProvider,
    fallbackModel: config.OPENAI_JUDGE_MODEL,
    request: async ({ model, provider, timeoutMs, signal }) => generateStructuredCompletion({
      model,
      systemPrompt: EVENT_UNDERSTANDING_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0,
      seed: 12345,
      maxTokens: 8192,
      timeoutMs,
      thinkingBudget: 0,
      signal,
      providerOverride: provider,
    }),
  });

  const content = response.content;

  logger.info("[DEBUG] Event understanding response received", {
    model: response.resolvedModel,
    contentLength: content.length,
    finishReason: response.finishReason,
  });

  return {
    rawResponse: content,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

async function callEventUnderstandingVerificationOpenAI(
  result: EventUnderstandingPassResult,
  options?: {
    signal?: AbortSignal;
    chunkController?: ChunkExecutionController;
  },
): Promise<{
  rawResponse: string;
  responseId: string | null;
  responseTimestamp: string;
  finishReason: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}> {
  const userPrompt = buildEventUnderstandingVerifierUserPrompt(result);

  const resolvedModel = resolveModelForRole("router", config.OPENAI_JUDGE_MODEL).model;

  logger.info("[DEBUG] Event understanding verifier request prepared", {
    model: resolvedModel,
    chunkStart: result.chunk_start,
    chunkEnd: result.chunk_end,
    eventCount: result.event_count,
  });

  const response = await runEventUnderstandingRequestWithLifecycle({
    prompt: userPrompt,
    systemPrompt: EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT,
    model: resolvedModel,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options?.signal,
    chunkController: options?.chunkController,
    providerOverride: getAIProviderPolicy().primaryProvider,
    fallbackModel: config.OPENAI_JUDGE_MODEL,
    request: async ({ model, provider, timeoutMs, signal }) => generateStructuredCompletion({
      model,
      systemPrompt: EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0,
      seed: 12345,
      maxTokens: 8192,
      timeoutMs,
      thinkingBudget: 0,
      signal,
      providerOverride: provider,
    }),
  });

  const content = response.content;
  logger.info("[DEBUG] Event understanding verifier response received", {
    model: response.resolvedModel,
    contentLength: content.length,
    finishReason: response.finishReason,
  });

  return {
    rawResponse: content,
    responseId: response.responseId,
    responseTimestamp: response.responseTimestamp,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

export async function buildEventUnderstandingPass(
  chunkText: string,
  chunkStart = 0,
  chunkEnd = chunkText.length,
  chunkIndex?: number,
  options?: {
    signal?: AbortSignal;
    chunkController?: ChunkExecutionController;
  },
): Promise<EventUnderstandingPassResult> {
  const startTime = Date.now();

  // Keep a reference to the AI result for error diagnostics
  let aiResult:
    | {
        rawResponse: string;
        finishReason: string | null;
        usage: AICompletionResponse["usage"];
      }
    | undefined;

  try {
    aiResult = await callEventUnderstandingOpenAI(
      chunkText,
      chunkStart,
      chunkEnd,
      options,
    );
    const raw = aiResult.rawResponse;
    const parsed = parseEventUnderstandingOutput(raw, chunkStart, chunkEnd, chunkText);
    const verification = await callEventUnderstandingVerificationOpenAI(parsed, options);
    const parsedVerification = parseEventUnderstandingVerificationOutput(
      verification.rawResponse,
      chunkText,
      parsed.events
    );
    const finalEvents =
      parsedVerification.status === "corrected"
        ? parsedVerification.events
        : parsed.events;
    const finalResult: EventUnderstandingPassResult = {
      chunk_start: parsed.chunk_start,
      chunk_end: parsed.chunk_end,
      event_count: finalEvents.length,
      events: finalEvents,
      original_event_count: parsed.event_count,
      original_events: parsed.events,
      verification: {
        status: parsedVerification.status,
        events: parsedVerification.status === "corrected" ? finalEvents : [],
        original_event_count: parsed.event_count,
        final_event_count: finalEvents.length,
        raw_response: verification.rawResponse,
        response_id: verification.responseId,
        response_timestamp: verification.responseTimestamp,
        prompt_tokens: verification.usage?.prompt_tokens ?? null,
        completion_tokens: verification.usage?.completion_tokens ?? null,
        total_tokens: verification.usage?.total_tokens ?? null,
        finish_reason: verification.finishReason,
      },
    };

    const elapsed = Date.now() - startTime;
    logger.info("Event Understanding Diagnostics", {
      chunkIndex,
      model: resolveModelForRole("router", config.OPENAI_JUDGE_MODEL).model,
      inputTokens: aiResult.usage?.prompt_tokens ?? 0,
      outputTokens: aiResult.usage?.completion_tokens ?? 0,
      finishReason: aiResult.finishReason,
      eventCount: finalResult.event_count,
      elapsedMs: elapsed,
    });

    if (finalResult.event_count > SOFT_EVENT_COUNT_WARNING_THRESHOLD) {
      logger.warn("Event understanding produced a high event count", {
        chunkStart,
        chunkEnd,
        chunkLength: chunkText.length,
        eventCount: finalResult.event_count,
        softThreshold: SOFT_EVENT_COUNT_WARNING_THRESHOLD,
      });
    }
    return finalResult;
  } catch (error: unknown) {
    const elapsed = Date.now() - startTime;
    const errObj = error as Record<string, any>;

    logger.error("Event Understanding Diagnostics (Failure)", {
      chunkIndex,
      model: resolveModelForRole("router", config.OPENAI_JUDGE_MODEL).model,
      inputTokens:
        aiResult?.usage?.prompt_tokens ?? errObj?.usage?.prompt_tokens ?? null,
      outputTokens:
        aiResult?.usage?.completion_tokens ??
        errObj?.usage?.completion_tokens ??
        null,
      finishReason: aiResult?.finishReason ?? errObj?.finishReason ?? null,
      elapsedMs: elapsed,
      error: error instanceof Error ? error.message : String(error),
    });

    logger.error("Event understanding pass failed", {
      chunkStart,
      chunkEnd,
      chunkLength: chunkText.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
