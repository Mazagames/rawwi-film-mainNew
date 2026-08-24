import { randomUUID } from "crypto";
import { generateStructuredCompletion } from "./aiClient.js";
import { config } from "./config.js";
import { canonicalStringify } from "./canonicalJson.js";
import { extractJsonFromText, noteOutputSchema, noteSchema, type NoteItem, type NoteOutput } from "./schemas.js";
import { logger } from "./logger.js";
import { getNoteDefinitions, type NoteReviewerDefinition } from "./notePromptPack.js";
import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import {
  countNoteCategoriesFromArray,
  getRenderedNoteTabLabel,
  logNoteCategoryMapping,
  logNotePipelineStage,
  normalizeNoteCategoryKey,
} from "./notePipelineTelemetry.js";

type OpenAiCallOptions = {
  signal?: AbortSignal;
};

export type NotePassResult = {
  passName: string;
  reviewerId: string;
  category: string;
  notes: NoteItem[];
  duration: number;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
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
    model: config.OPENAI_JUDGE_MODEL,
    eventCount: args.events.length,
    chunkLength: args.chunkText.length,
  });

  const response = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
    systemPrompt: systemPrompt,
    userPrompt: userPrompt,
    temperature: args.temperature,
    seed: args.seed,
    maxTokens: config.AI_PROVIDER === "gemini" ? 16384 : 8192,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
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

  for (const definition of noteDefinitions) {
    const passStartedAt = Date.now();
    try {
      const response = await callNotesOpenAI({
        definition,
        events,
        chunkText,
        temperature: jobConfig.temperature,
        seed: jobConfig.seed,
        signal: options.signal,
      });
      const parsed = await parseNotesWithRepair(response.rawResponse, config.OPENAI_JUDGE_MODEL, options.signal);
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
      allNotes.push(...normalizedNotes);
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
      passResults.push({
        passName: definition.id,
        reviewerId: definition.id,
        category: definition.category,
        notes: normalizedNotes,
        duration: Date.now() - passStartedAt,
        model: config.OPENAI_JUDGE_MODEL,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      });
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
    } catch (error) {
      logger.warn("Note reviewer failed", {
        jobId: options.jobId,
        chunkId: options.chunkId,
        reviewer: definition.id,
        category: definition.category,
        error: error instanceof Error ? error.message : String(error),
      });
      passResults.push({
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
      });
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
