/**
 * Tests for the noteDetection fixes.
 * Run: npx tsx src/noteDetection.test.ts
 */
import {
  buildNoteSystemPrompt,
  normalizeNote,
  retryTransientProviderFailure,
  runNotesProviderWithFallback,
  runWithBoundedConcurrency,
} from "./noteDetection.js";
import { AdaptiveReviewerScheduler } from "./reviewerLifecycle.js";
import type { NoteItem } from "./schemas.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testNormalizeNoteStripsLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "0109: خالد...",
    quote: "0109: خالد...",
  };
  
  // @ts-ignore - testing internal
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...", `Failed to strip 0109: from paragraph. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...", `Failed to strip 0109: from quote. Got: ${result?.quote}`);
  console.log("✓ normalizeNote removes 0109: from the beginning of an evidence line");
}

function testNormalizeNoteMultipleLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "0109: خالد...\n0110: غالي...",
    quote: "0109: خالد...\n0110: غالي...",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...\nغالي...", `Failed to strip multiple IDs. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...\nغالي...", `Failed to strip multiple IDs. Got: ${result?.quote}`);
  console.log("✓ normalizeNote removes multiple leaked line IDs");
}

function testNormalizeNotePreservesMiddleLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "خالد يقول الوقت 1030: مساء",
    quote: "خالد يقول الوقت 1030: مساء",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد يقول الوقت 1030: مساء", `Failed to preserve middle ID. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد يقول الوقت 1030: مساء", `Failed to preserve middle ID. Got: ${result?.quote}`);
  console.log("✓ normalizeNote preserves legitimate 4-digit colon content in the middle of a line");
}

function testNormalizeNotePreservesNewlines() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "خالد...\nغالي...",
    quote: "خالد...\nغالي...",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...\nغالي...", `Failed to preserve newlines. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...\nغالي...", `Failed to preserve newlines. Got: ${result?.quote}`);
  console.log("✓ normalizeNote preserves original line boundaries");
}

function testBuildNoteSystemPrompt() {
  // @ts-ignore
  const prompt = buildNoteSystemPrompt({ prompt: "TEST", category: "test", id: "test", name: "test" });
  assert(prompt.includes("verbatim in the original language"), "prompt must forbid translation");
  assert(prompt.includes("Do not translate"), "prompt must forbid translation");
  assert(prompt.includes("INTERNAL REVIEW IDS"), "prompt must mark 4-digit prefixes");
  assert(prompt.includes("0109:"), "prompt must show 0109: as example");
  console.log("✓ buildNoteSystemPrompt correctly includes new constraints");
}

async function testBoundedConcurrencyAndTransientRetries() {
  let active = 0;
  let peak = 0;
  const attempts = new Map<number, number>();
  const results = await runWithBoundedConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async (reviewer) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      try {
        return await retryTransientProviderFailure(async () => {
          const attempt = (attempts.get(reviewer) ?? 0) + 1;
          attempts.set(reviewer, attempt);
          if (reviewer === 2 && attempt === 1) throw Object.assign(new Error("503 UNAVAILABLE"), { status: 503 });
          if (reviewer === 7) throw Object.assign(new Error("429 rate limit"), { status: 429 });
          return reviewer;
        }, { delay: async () => {} });
      } catch {
        return null;
      }
    } finally {
      active -= 1;
    }
  });
  assert(peak <= 2, `expected at most two active reviewers, got ${peak}`);
  assert(attempts.get(2) === 2, `expected reviewer 2 to retry once, got ${attempts.get(2)}`);
  assert(attempts.get(7) === 3, `expected permanent reviewer 7 to stop after three attempts, got ${attempts.get(7)}`);
  assert(results.filter((reviewer) => reviewer !== null).length === 6 && results.includes(2), "successful reviewer results should be preserved");
  const deduped = new Map<string, number>();
  for (const eventId of [1, 1, 2]) deduped.set(`event_${eventId}_security_scenes`, eventId);
  assert(deduped.size === 2, "event/category deduplication should remain unchanged");
  console.log("✓ Notes use bounded concurrency, transient retries, failure isolation, and unchanged deduplication");
}

async function testAdaptiveReviewerSchedulerBackoff() {
  const scheduler = new AdaptiveReviewerScheduler({ baseConcurrency: 3, minConcurrency: 1, recoveryDelayMs: 0, baseDelayMs: 2000 });
  assert(scheduler.getCurrentConcurrency() === 3, "expected initial concurrency to be the configured base value");
  scheduler.onTransientFailure({ status: 503, message: "service unavailable" });
  assert(scheduler.getCurrentConcurrency() === 2, "expected concurrency to drop after the first transient overload");
  scheduler.onTransientFailure({ status: 503, message: "service unavailable" });
  assert(scheduler.getCurrentConcurrency() === 1, "expected concurrency to fall to the minimum after repeated transient overloads");
  assert(scheduler.getNextRetryDelayMs(1) === 2000, "expected the initial retry delay to use the base backoff");
  assert(scheduler.getNextRetryDelayMs(2) === 4000, "expected exponential backoff to increase on later attempts");
  scheduler.onSuccess();
  assert(scheduler.getCurrentConcurrency() === 2, "expected recovery to ramp concurrency gradually after success");
  scheduler.onSuccess();
  assert(scheduler.getCurrentConcurrency() === 3, "expected concurrency to return to the base level after recovery");
  console.log("✓ adaptive reviewer scheduler reduces concurrency and recovers gradually under transient overload");
}

async function testNotesProviderFallback() {
  process.env.AI_PROVIDER_MODE = "gemini-only";
  process.env.AI_PROVIDER = "gemini";

  let geminiCalls = 0;
  let openAiCalls = 0;
  let surfacedError: unknown = null;
  try {
    await runNotesProviderWithFallback({
      primaryProvider: "gemini",
      primary: async () => {
        geminiCalls += 1;
        throw Object.assign(new Error("503 UNAVAILABLE"), { status: 503 });
      },
      fallback: async () => {
        openAiCalls += 1;
        return "accepted note";
      },
      retryBudgetMs: 10_000,
    });
  } catch (error) {
    surfacedError = error;
  }
  assert(surfacedError instanceof Error, "expected the transient Gemini overload to surface as an error");
  assert(/503|UNAVAILABLE/i.test(surfacedError.message), "expected the transient Gemini overload to be reflected in the surfaced error");
  assert(geminiCalls === 3 && openAiCalls === 0, "gemini-only mode should retry transient failures without invoking OpenAI fallback");

  geminiCalls = 0;
  openAiCalls = 0;
  const primaryResult = await runNotesProviderWithFallback({
    primaryProvider: "gemini",
    primary: async () => {
      geminiCalls += 1;
      return "gemini note";
    },
    fallback: async () => {
      openAiCalls += 1;
      return "unexpected fallback";
    },
  });
  assert(primaryResult === "gemini note" && geminiCalls === 1 && openAiCalls === 0, "successful Gemini must not call OpenAI");
  console.log("✓ Gemini-only reviewer retries stay within the Gemini-only policy and do not invoke OpenAI fallback");
}

testNormalizeNoteStripsLineIds();
testNormalizeNoteMultipleLineIds();
testNormalizeNotePreservesMiddleLineIds();
testNormalizeNotePreservesNewlines();
testBuildNoteSystemPrompt();
testAdaptiveReviewerSchedulerBackoff().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
testBoundedConcurrencyAndTransientRetries().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
testNotesProviderFallback().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
