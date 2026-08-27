/**
 * Investigation: Capture raw EventUnderstandingVerification response from Gemini
 * This script does NOT modify any production code.
 * It only observes and reports the raw API response.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { config } from './src/config.js';
import { generateStructuredCompletion } from './src/aiClient.js';
import { canonicalStringify } from './src/canonicalJson.js';
import { extractJsonFromText } from './src/schemas.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ─── Schemas (identical copy from eventUnderstanding.ts, not imported to avoid mutation) ───

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

const EVENT_SCHEMA = z.object({
  event_id: z.preprocess(toNumber, z.number().int().min(1)),
  event_summary: z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string().min(1)),
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

const VERIFICATION_SCHEMA = z.union([
  z.object({ status: z.literal('ok') }),
  z.object({
    status: z.literal('corrected'),
    events: z.array(EVENT_SCHEMA).min(1),
  }),
  z.object({ events: z.array(EVENT_SCHEMA).min(1) })
    .transform(v => ({ status: 'corrected' as const, events: v.events })),
]);

// ─── Representative chunk (short, neutral, real-world shaped) ───

const CHUNK_TEXT = `في مقطع من المسلسل، يدخل الأب إلى الغرفة حاملاً مسدساً. يقول لابنه: "إذا رأيتك مرة ثانية مع هؤلاء، سأقتلك بيدي." يحاول الابن الفرار لكن الأب يمسك به.

ثم يظهر الصديق ويحاول التوسط قائلاً: "أرجوك، الولد لم يفعل شيئاً." الأب يدفعه جانباً ويصيح: "أنت لا دخل لك في هذا."`;

const CHUNK_START = 0;
const CHUNK_END = CHUNK_TEXT.length;

async function run() {
  const resolvedModel = config.AI_PROVIDER === 'gemini'
    ? config.GEMINI_ROUTER_MODEL
    : config.OPENAI_JUDGE_MODEL;

  console.log('\n=== INVESTIGATION: EventUnderstandingVerification Zod Failure ===');
  console.log('Provider:', config.AI_PROVIDER);
  console.log('Resolved model:', resolvedModel);
  console.log('Chunk length:', CHUNK_TEXT.length, 'chars');
  console.log('');

  // ─── STEP 1: Event Understanding (initial pass) ───
  const euSystemPrompt = `You are a screenplay understanding engine.
You are NOT a GCAM reviewer.
Your only responsibility is to understand narrative events in the screenplay.
Return only structured JSON.`;

  const euUserPrompt = `Screenplay chunk (offsets ${CHUNK_START}-${CHUNK_END}):
${CHUNK_TEXT}

Return only structured JSON:
{
  "chunk_start": ${CHUNK_START},
  "chunk_end": ${CHUNK_END},
  "event_count": 0,
  "events": [
    {
      "event_id": 1,
      "event_summary": "",
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

  console.log('--- STEP 1: Calling Event Understanding ---');
  const euResponse = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: euSystemPrompt,
    userPrompt: euUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });

  console.log('\n[EU Raw Response]:', euResponse.content);
  console.log('[EU FinishReason]:', euResponse.finishReason);
  console.log('[EU Usage]:', euResponse.usage);

  // Parse EU response
  let parsedEU: any;
  try {
    const json = extractJsonFromText(euResponse.content);
    parsedEU = JSON.parse(json);
    console.log('\n[EU Parsed events count]:', parsedEU?.events?.length);
  } catch (e: any) {
    console.error('[EU Parse Error]:', e.message);
    process.exit(1);
  }

  // Build a simplified event result for the verifier
  const euResult = {
    chunk_start: CHUNK_START,
    chunk_end: CHUNK_END,
    event_count: parsedEU?.events?.length ?? 0,
    events: parsedEU?.events ?? [],
  };

  // ─── STEP 2: Verification ───
  const verifierSystemPrompt = `You are a screenplay understanding verifier.

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

  const verifierUserPrompt = `Compare the structured events with the understanding criteria.

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
  chunk_start: euResult.chunk_start,
  chunk_end: euResult.chunk_end,
  event_count: euResult.event_count,
  events: euResult.events,
})}

Return only valid JSON matching one of these shapes:
{ "status": "ok" }

or:
{
  "status": "corrected",
  "events": [ ... corrected structured events ... ]
}`;

  console.log('\n\n--- STEP 2: Calling Verification ---');
  console.log('\n[VERIFIER SYSTEM PROMPT]:\n', verifierSystemPrompt);
  console.log('\n[VERIFIER USER PROMPT (first 800 chars)]:\n', verifierUserPrompt.slice(0, 800));

  const verResponse = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: verifierSystemPrompt,
    userPrompt: verifierUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });

  console.log('\n\n=== RAW VERIFIER RESPONSE (from Gemini) ===');
  console.log(verResponse.content);
  console.log('\n[Verifier FinishReason]:', verResponse.finishReason);
  console.log('[Verifier Usage]:', verResponse.usage);

  // ─── STEP 3: Attempt to parse with the production Zod schema ───
  console.log('\n\n--- STEP 3: Zod Parse Attempt ---');
  try {
    const json = extractJsonFromText(verResponse.content);
    console.log('[Extracted JSON]:', json);
    const parsed = JSON.parse(json);
    console.log('[Raw parsed object]:', JSON.stringify(parsed, null, 2));

    const result = VERIFICATION_SCHEMA.parse(parsed);
    console.log('\n[Zod parse SUCCESS]:', JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error('\n[Zod parse FAILED]:');
    console.error(e.message);

    // Show what was actually in the raw response
    console.log('\n[Raw response for analysis]:', JSON.stringify(verResponse.content));
  }

  // ─── STEP 4: Repeat once more to check determinism ───
  console.log('\n\n--- STEP 4: Second call to check determinism ---');
  const verResponse2 = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: verifierSystemPrompt,
    userPrompt: verifierUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });
  console.log('[Second Verifier Raw Response]:', verResponse2.content);

  const sameContent = verResponse.content === verResponse2.content;
  console.log('[Responses identical?]:', sameContent);
  if (!sameContent) {
    console.log('[Diff: First]:', verResponse.content.slice(0, 200));
    console.log('[Diff: Second]:', verResponse2.content.slice(0, 200));
  }

  console.log('\n=== Investigation Complete ===');
  process.exit(0);
}

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
