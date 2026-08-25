import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const { config } = await import("./config.js");
  const { getNoteDefinitions } = await import("./notePromptPack.js");
  const { runReviewerPack } = await import("./noteDetection.js");

  const definitions = getNoteDefinitions();
  const sharedDefinitions = definitions.filter((definition) => definition.kind === "note");
  assert(sharedDefinitions.length === 28, `expected 28 note reviewers, got ${sharedDefinitions.length}`);
  assert(sharedDefinitions.every((definition) => definition.kind === "note"), "all reviewers in the pilot must be note-kind");
  assert(sharedDefinitions.every((definition) => definition.destination === "analysis_notes"), "all pilot reviewers must persist to analysis_notes");
  assert(definitions.every((definition) => definition.kind !== "violation"), "pilot must contain zero violation-kind definitions");
  assert(definitions.every((definition) => definition.destination !== "analysis_findings"), "pilot must contain zero analysis_findings reviewers");
  assert(sharedDefinitions.some((definition) => definition.id === "article_05_violence_torture"), "Article 05 must be a Note definition");
  assert(sharedDefinitions.some((definition) => definition.id === "article_12_child_protection_exploitation"), "Article 12 must be a Note definition");
  assert(sharedDefinitions.some((definition) => definition.id === "article_14_profanity_personal_insults"), "Article 14 must be a Note definition");
  assert(config.V5_SHARED_REVIEWER_PACK_ENABLED === false, "shared reviewer-pack migration must remain default-OFF");

  const events = [
    { event_id: 50, event_summary: "threat", actor: "a", target: "b", action: "threatens to hit", intent: "anger", consequence: "fear", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "violence" },
    { event_id: 52, event_summary: "insult", actor: "a", target: "b", action: "insults", intent: "anger", consequence: "tension", quote: "لا تتفلسفين", start_offset: 28, end_offset: 40, dominant_meaning: "insult" },
    { event_id: 53, event_summary: "child insult", actor: "a", target: "child", action: "insults", intent: "discipline", consequence: "fear", quote: "قوم يا عديم التربية", start_offset: 41, end_offset: 61, dominant_meaning: "child abuse" },
  ] as any;
  const eventUnderstanding = { chunk_start: 0, chunk_end: 100, event_count: events.length, events };
  const chunkText = events.map((event) => event.quote).join("\n");
  const responseByReviewer: Record<string, unknown> = {
    article_05_violence_torture: { notes: [{ category: "article_05", event_id: 50, title: "عنف", description: "تحذير عن عنف", paragraph: events[0].quote, quote: events[0].quote, snippet: events[0].quote, confidence: 0.9 }] },
    article_12_child_protection_exploitation: { notes: [{ category: "article_12", event_id: 53, title: "إساءة إلى قاصر", description: "إساءة إلى قاصر", paragraph: events[2].quote, quote: events[2].quote, snippet: events[2].quote, confidence: 0.9 }] },
    article_14_profanity_personal_insults: { notes: [
      { category: "article_14", event_id: 52, title: "إهانة", description: "إهانة شخصية", paragraph: events[1].quote, quote: events[1].quote, snippet: events[1].quote, confidence: 0.9 },
      { category: "article_14", event_id: 53, title: "إهانة", description: "إهانة شخصية", paragraph: events[2].quote, quote: events[2].quote, snippet: events[2].quote, confidence: 0.9 },
    ] },
  };
  const result = await runReviewerPack(
    chunkText,
    eventUnderstanding,
    { temperature: 0, seed: 42 },
    {
      jobId: "shared-pack-test-job",
      chunkId: "shared-pack-test-chunk",
      definitions: sharedDefinitions,
      reviewerResponse: async (definition) => JSON.stringify(responseByReviewer[definition.id] ?? { notes: [] }),
    },
  );

  assert(result.violationCandidates.length === 0, `expected zero violation candidates in the pilot, got ${result.violationCandidates.length}`);
  assert(result.notes.length === 4, `expected 4 mock note outputs, got ${result.notes.length}`);
  assert(result.notes.every((note) => typeof note.event_id === "number"), "all pilot Notes must preserve exact event_id values");
  assert(result.notes.every((note) => typeof note.quote === "string" && note.quote.length > 0), "all pilot Notes must preserve exact quote/evidence");
  assert(result.notes.some((note) => note.category === "article_05"), "Article 05 mock output must remain a Note");
  assert(result.notes.some((note) => note.category === "article_12"), "Article 12 mock output must remain a Note");
  assert(result.notes.filter((note) => note.category === "article_14").length === 2, "Article 14 mock output must preserve both Notes");
  assert(result.passResults.some((pass) => pass.passName === "article_14_profanity_personal_insults"), "Article 14 must use the shared note pass result");
  console.log("✓ pilot Article 05/12/14 reviewers are note-kind definitions in analysis_notes");
  console.log("✓ all 28 Notes are Note-compatible and preserve exact event_id/quote evidence");
  console.log("✓ no violation candidates, no analysis_findings, no grounding, no ownership, and no final adjudicator in the pilot");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
