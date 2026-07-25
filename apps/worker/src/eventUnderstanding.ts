import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import { canonicalStringify } from "./canonicalJson.js";
import { extractJsonFromText } from "./schemas.js";
import { logger } from "./logger.js";

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export type StructuredEvent = {
  event_id: number;
  actor: string;
  target: string;
  action: string;
  intent: string;
  consequence: string;
  quote: string;
  start_offset: number;
  end_offset: number;
  dominant_meaning: string;
};

export type EventUnderstandingPassResult = {
  chunk_start: number;
  chunk_end: number;
  event_count: number;
  events: StructuredEvent[];
};

export const EVENT_UNDERSTANDING_SYSTEM_PROMPT = `You are a screenplay understanding engine.

You are NOT a GCAM reviewer.
You are NOT evaluating policy.
You are NOT detecting violations.
You are NOT classifying content.

Your only responsibility is to understand narrative events in the screenplay.

Your output will later be reviewed by specialized GCAM reviewers.

Your responsibility is only to produce an objective and accurate understanding of what happens.

This layer is domain-neutral. If the same screenplay were analyzed for copyright, education, or storytelling instead of GCAM compliance, the extracted events should be identical.`;

const EVENT_UNDERSTANDING_EVENT_SCHEMA = z.object({
  event_id: z.preprocess(toNumber, z.number().int().min(1)),
  actor: z.preprocess(toStringValue, z.string()),
  target: z.preprocess(toStringValue, z.string()),
  action: z.preprocess(toStringValue, z.string()),
  intent: z.preprocess(toStringValue, z.string()),
  consequence: z.preprocess(toStringValue, z.string()),
  quote: z.preprocess(toStringValue, z.string()),
  start_offset: z.preprocess(toNumber, z.number().int().min(0)),
  end_offset: z.preprocess(toNumber, z.number().int().min(0)),
  dominant_meaning: z.preprocess(toStringValue, z.string()),
});

const EVENT_UNDERSTANDING_OUTPUT_SCHEMA = z.object({
  chunk_start: z.preprocess(toNumber, z.number().int().min(0)).optional().nullable().transform((value) => (typeof value === "number" ? value : 0)),
  chunk_end: z.preprocess(toNumber, z.number().int().min(0)).optional().nullable().transform((value) => (typeof value === "number" ? value : 0)),
  event_count: z.preprocess(toNumber, z.number().int().min(0)).optional().nullable().transform((value) => (typeof value === "number" ? value : 0)),
  events: z.array(EVENT_UNDERSTANDING_EVENT_SCHEMA),
});

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

export function buildEventUnderstandingUserPrompt(chunkText: string, chunkStart: number, chunkEnd: number): string {
  return `Read the entire screenplay chunk before producing any output.
Do not begin extracting events while reading.
First understand the complete sequence of actions and interactions.

Only after understanding the entire chunk, identify every independent narrative event.

An event is a continuous action involving:

- one dominant actor
- one dominant action
- one dominant purpose
- one immediate consequence

A new event begins whenever the dominant actor, action, objective, or consequence changes.

Do not create events for:

- scene headings
- location headings
- camera directions
- transitions
- atmosphere
- environmental descriptions
- character emotions alone
- background narration

unless they contain a meaningful observable action or interaction.

Do not merge unrelated events.
Do not split a single continuous action unnecessarily.

For every event determine:

- actor
- target
- action
- intent (only if explicitly supported)
- consequence (only if explicitly supported)

The action must always be the central observable action and must be expressed as a verb or a short verb phrase describing what actually happened.
Good action examples: Hits, Threatens, Leaks, Insults, Publishes, Steals.
Bad action examples: Conflict, Conversation, Scene, Problem, Violence.

If information is not explicitly supported by the screenplay, leave it empty.

Extract the shortest verbatim quotation that completely supports the event.

Never paraphrase.
Never summarize.
Never classify.
Never reference GCAM.
Never evaluate legality.
Never determine violations.
Never assign articles.

If multiple interpretations are possible and the screenplay does not clearly support one interpretation, choose the most objective observable description of the event.
Never infer hidden motives, emotions, intentions, or meanings unless they are explicitly supported by the screenplay.
For example, if the screenplay says only "He smiles.", do not infer mocking, manipulating, or threatening unless the text explicitly supports that.

dominant_meaning must be a short objective description of the event.
Good dominant_meaning examples: Physical assault, Verbal threat, Religious discussion, Political speech, Drug transaction, Family argument, Information disclosure.
Bad dominant_meaning examples: Illegal, Dangerous, Violation, Article 12, Offensive.

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

export function renderStructuredEventContext(result: EventUnderstandingPassResult): string {
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
    "Event Understanding Pass",
    "This is a deterministic pre-review understanding layer, not a GCAM reviewer.",
    "Use only the structured events below. Do not rediscover events from prose.",
    "One event may support at most one finding.",
    payload,
  ].join("\n\n");
}

export function parseEventUnderstandingOutput(
  raw: string,
  chunkStart: number,
  chunkEnd: number,
): EventUnderstandingPassResult {
  const json = extractJsonFromText(raw);
  const parsed = JSON.parse(json) as unknown;
  const output = EVENT_UNDERSTANDING_OUTPUT_SCHEMA.parse(parsed);
  const events = output.events.map((event) => ({
    event_id: event.event_id,
    actor: event.actor,
    target: event.target,
    action: event.action,
    intent: event.intent,
    consequence: event.consequence,
    quote: event.quote,
    start_offset: event.start_offset,
    end_offset: event.end_offset,
    dominant_meaning: event.dominant_meaning,
  }));

  return {
    chunk_start: chunkStart,
    chunk_end: chunkEnd,
    event_count: events.length,
    events,
  };
}

async function callEventUnderstandingOpenAI(chunkText: string, chunkStart: number, chunkEnd: number): Promise<string> {
  const userPrompt = buildEventUnderstandingUserPrompt(chunkText, chunkStart, chunkEnd);

  logger.info("[DEBUG] Event understanding request prepared", {
    model: config.OPENAI_JUDGE_MODEL,
    chunkStart,
    chunkEnd,
    chunkLength: chunkText.length,
  });

  const response = await openai.chat.completions.create({
    model: config.OPENAI_JUDGE_MODEL,
    messages: [
      { role: "system", content: EVENT_UNDERSTANDING_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    seed: 12345,
    max_tokens: 4096,
  }, { timeout: config.JUDGE_TIMEOUT_MS });

  const content = response.choices[0]?.message?.content ?? "{}";

  logger.info("[DEBUG] Event understanding response received", {
    model: config.OPENAI_JUDGE_MODEL,
    contentLength: content.length,
    finishReason: response.choices[0]?.finish_reason ?? null,
  });

  return content;
}

export async function buildEventUnderstandingPass(
  chunkText: string,
  chunkStart = 0,
  chunkEnd = chunkText.length,
): Promise<EventUnderstandingPassResult> {
  try {
    const raw = await callEventUnderstandingOpenAI(chunkText, chunkStart, chunkEnd);
    return parseEventUnderstandingOutput(raw, chunkStart, chunkEnd);
  } catch (error) {
    logger.error("Event understanding pass failed", {
      chunkStart,
      chunkEnd,
      chunkLength: chunkText.length,
      error: String(error),
    });
    throw error;
  }
}
