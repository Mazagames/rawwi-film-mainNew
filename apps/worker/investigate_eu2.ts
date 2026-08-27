/**
 * Investigation: Capture raw EventUnderstandingVerification response from Gemini
 * Uses the ACTUAL production chunk_0_raw.txt to reproduce the Zod failure.
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

const CHUNK_TEXT = fs.readFileSync(path.join(process.cwd(), 'chunk_0_raw.txt'), 'utf8');
const CHUNK_START = 0;
const CHUNK_END = CHUNK_TEXT.length;

async function run() {
  const resolvedModel = config.AI_PROVIDER === 'gemini'
    ? config.GEMINI_ROUTER_MODEL
    : config.OPENAI_JUDGE_MODEL;

  console.log('=== INVESTIGATION: Production Chunk EventUnderstandingVerification ===');
  console.log('Provider:', config.AI_PROVIDER);
  console.log('Resolved model:', resolvedModel);
  console.log('Chunk length:', CHUNK_TEXT.length, 'chars');

  // Import production EU system prompt directly
  const { EVENT_UNDERSTANDING_SYSTEM_PROMPT, EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT, buildEventUnderstandingUserPrompt, buildEventUnderstandingVerifierUserPrompt } = await import('./src/eventUnderstanding.js');

  // ─── STEP 1: Event Understanding ───
  console.log('\n--- STEP 1: Event Understanding (production prompts) ---');
  const euUserPrompt = buildEventUnderstandingUserPrompt(CHUNK_TEXT, CHUNK_START, CHUNK_END);
  
  const euResponse = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: EVENT_UNDERSTANDING_SYSTEM_PROMPT,
    userPrompt: euUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });

  console.log('[EU FinishReason]:', euResponse.finishReason);
  console.log('[EU Usage]:', euResponse.usage);

  let parsedEU: any;
  try {
    const json = extractJsonFromText(euResponse.content);
    parsedEU = JSON.parse(json);
    console.log('[EU event count]:', parsedEU?.events?.length);
  } catch (e: any) {
    console.error('[EU parse error]:', e.message);
    console.log('[EU raw]:', euResponse.content.slice(0, 500));
    process.exit(1);
  }

  const euResult = {
    chunk_start: CHUNK_START,
    chunk_end: CHUNK_END,
    event_count: parsedEU?.events?.length ?? 0,
    events: parsedEU?.events ?? [],
    original_event_count: parsedEU?.events?.length ?? 0,
    original_events: parsedEU?.events ?? [],
  };

  // ─── STEP 2: Verification using production prompt ───
  console.log('\n--- STEP 2: Verification (production prompt, production chunk) ---');
  const verUserPrompt = buildEventUnderstandingVerifierUserPrompt(euResult);
  
  console.log('[Verifier prompt length]:', verUserPrompt.length);
  console.log('[Events sent to verifier]:', euResult.event_count);

  const verResponse = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT,
    userPrompt: verUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });

  console.log('\n=== RAW VERIFIER RESPONSE ===');
  console.log(verResponse.content);
  console.log('\n[Verifier FinishReason]:', verResponse.finishReason);
  console.log('[Verifier Usage]:', verResponse.usage);

  // ─── STEP 3: Zod Parse ───
  console.log('\n--- STEP 3: Zod Parse ---');
  try {
    const json = extractJsonFromText(verResponse.content);
    const raw = JSON.parse(json);
    console.log('[status field]:', raw?.status);
    console.log('[has events field]:', !!raw?.events);
    if (raw?.events) {
      console.log('[events[0] keys]:', Object.keys(raw.events[0] ?? {}));
      console.log('[events[0].event_id]:', raw.events[0]?.event_id);
      console.log('[events[0].event_summary]:', raw.events[0]?.event_summary?.slice(0, 80));
    }
    const result = VERIFICATION_SCHEMA.parse(raw);
    console.log('\n✅ Zod parse SUCCESS, status:', result.status);
  } catch (e: any) {
    console.error('\n❌ Zod parse FAILED:', e.message);
  }

  // ─── STEP 4: Second call for determinism ───
  console.log('\n--- STEP 4: Second call (determinism check) ---');
  const verResponse2 = await generateStructuredCompletion({
    model: resolvedModel,
    systemPrompt: EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT,
    userPrompt: verUserPrompt,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: 120000,
    thinkingBudget: 0,
  });
  console.log('[Second raw response (first 200)]:', verResponse2.content.slice(0, 200));
  console.log('[Responses identical?]:', verResponse.content === verResponse2.content);

  process.exit(0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
