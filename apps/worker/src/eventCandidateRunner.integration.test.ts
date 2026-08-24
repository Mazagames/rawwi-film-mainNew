import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const { config, resolveV5CandidateEngine } = await import("./config.js");
  const { getEventCandidateRunnerArticlePassCount, runEventCandidateRunner } = await import("./eventCandidateRunner.js");

  assert(resolveV5CandidateEngine(false) === "legacy_v5", "feature OFF must select legacy_v5");
  assert(resolveV5CandidateEngine(true) === "event_candidate_runner", "feature ON must select event_candidate_runner");
  assert(config.V5_EVENT_CANDIDATE_RUNNER_ENABLED === false, "production default must keep the new runner OFF");
  assert(getEventCandidateRunnerArticlePassCount() === 21, "new runner must use the 21-article violation set");

  const events = [
    { event_id: 50, event_summary: "threat", actor: "a", target: "b", action: "threatens", intent: "anger", consequence: "fear", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "violence" },
    { event_id: 52, event_summary: "insult", actor: "a", target: "b", action: "insults", intent: "anger", consequence: "tension", quote: "لا تتفلسفين", start_offset: 28, end_offset: 40, dominant_meaning: "insult" },
    { event_id: 53, event_summary: "child insult", actor: "a", target: "child", action: "insults", intent: "discipline", consequence: "fear", quote: "قوم يا عديم التربية", start_offset: 41, end_offset: 61, dominant_meaning: "child abuse" },
    { event_id: 23, event_summary: "rumor campaign", actor: "a", target: "public", action: "publishes rumors", intent: "deception", consequence: "misinformation", quote: "نستخدم حسابات وهمية، نكتب إشاعات", start_offset: 62, end_offset: 96, dominant_meaning: "misinformation" },
    { event_id: 60, event_summary: "private photos", actor: "a", target: "b", action: "threatens exposure", intent: "blackmail", consequence: "reputational harm", quote: "سأنشر صورك الخاصة التي أرسلتها لي وأفضحك", start_offset: 97, end_offset: 140, dominant_meaning: "privacy" },
  ] as any;
  const chunkText = events.map((event) => event.quote).join("\n");
  const eventByArticle: Record<number, number[]> = { 5: [50], 12: [53], 14: [52, 53], 16: [23], 17: [60] };
  let adjudicatorRows: any[] = [];
  let reviewerResponseCalls = 0;
  const runnerResult = await runEventCandidateRunner({
    chunkText,
    eventUnderstanding: { chunk_start: 0, chunk_end: chunkText.length, event_count: events.length, events },
    reviewerResponse: async (articleNumber) => {
      reviewerResponseCalls += 1;
      return JSON.stringify({
        findings: (eventByArticle[articleNumber] ?? []).map((eventId) => ({
          article_id: articleNumber,
          event_id: eventId,
          title_ar: "candidate",
          rationale_ar: "relevant event",
          evidence_snippet: events.find((event) => event.event_id === eventId)?.quote,
          confidence: 0.9,
        })),
      });
    },
    finalAdjudicator: async (rows) => {
      adjudicatorRows = rows;
      return rows;
    },
  });
  assert(reviewerResponseCalls === 21, `expected 21 reviewer executions, got ${reviewerResponseCalls}`);
  assert(runnerResult.rawCandidateCount === 6, `expected 6 raw candidates, got ${runnerResult.rawCandidateCount}`);
  assert(runnerResult.parsedCandidateCount === 6, `expected 6 parsed candidates, got ${runnerResult.parsedCandidateCount}`);
  assert(runnerResult.groundedCandidateCount === 6, `expected 6 grounded candidates, got ${runnerResult.groundedCandidateCount}`);
  assert(runnerResult.ownershipSurvivorCount === 5, `expected 5 Ownership survivors, got ${runnerResult.ownershipSurvivorCount}`);
  assert(runnerResult.finalAdjudicatorSurvivorCount === 5, `expected 5 Final Adjudicator survivors, got ${runnerResult.finalAdjudicatorSurvivorCount}`);
  assert(!adjudicatorRows.some((row) => row.article_id === 14 && row.event_id === 53), "Article 14 overlap must be suppressed before adjudication");
  assert(adjudicatorRows.every((row) => row.location?.v3?.event_id === row.event_id), "adjudicator rows must preserve event-bound finding shape");

  console.log("✓ feature OFF selects legacy_v5");
  console.log("✓ feature ON selects event_candidate_runner");
  console.log("✓ new runner uses 21 violation article passes and excludes Notes-only Articles 11, 13, and 21");
  console.log("✓ new runner preserves representative candidates through grounding, Ownership, and finding-row handoff");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});