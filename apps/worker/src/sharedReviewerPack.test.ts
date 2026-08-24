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
  const sharedDefinitions = definitions.filter((definition) => definition.kind === "note" || definition.id === "article_12_child_protection_exploitation");
  assert(sharedDefinitions.length === 9, `expected 8 Note reviewers plus Article 12, got ${sharedDefinitions.length}`);
  assert(config.V5_SHARED_REVIEWER_PACK_ENABLED === false, "shared reviewer-pack migration must remain default-OFF");

  const events = [
    { event_id: 50, event_summary: "threat", actor: "a", target: "b", action: "threatens to hit", intent: "anger", consequence: "fear", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "violence" },
    { event_id: 52, event_summary: "insult", actor: "a", target: "b", action: "insults", intent: "anger", consequence: "tension", quote: "لا تتفلسفين", start_offset: 28, end_offset: 40, dominant_meaning: "insult" },
    { event_id: 53, event_summary: "child insult", actor: "a", target: "child", action: "insults", intent: "discipline", consequence: "fear", quote: "قوم يا عديم التربية", start_offset: 41, end_offset: 61, dominant_meaning: "child abuse" },
  ] as any;
  const eventUnderstanding = { chunk_start: 0, chunk_end: 100, event_count: events.length, events };
  const chunkText = events.map((event) => event.quote).join("\n");
  const responseByReviewer: Record<string, unknown> = {
    article_12_child_protection_exploitation: { findings: [{ article_id: 12, event_id: 53, title_ar: "حماية طفل", rationale_ar: "إهانة طفل", evidence_snippet: events[2].quote, confidence: 0.9 }] },
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

  const violations = result.violationCandidates;
  assert(violations.length === 1, `expected 1 raw violation candidate, got ${violations.length}`);
  assert(violations[0].article_id === 12 && violations[0].event_id === 53, "only Article 12 should remain a violation candidate");
  assert(result.notes.length === 2, `expected 2 Article 14 notes, got ${result.notes.length}`);
  assert(result.notes.every((note) => note.category === "article_14" && typeof note.event_id === "number"), "Article 14 output must remain Notes");
  assert(result.passResults.some((pass) => pass.passName === "article_14_profanity_personal_insults"), "Article 14 must use the shared note pass result");
  console.log("✓ shared reviewer-pack executor keeps Article 14 as analysis_notes and Article 12 as a violation candidate");
  console.log("✓ Article 14 output preserves exact event_id/evidence without entering JudgeFinding-compatible violation output");
  console.log("✓ existing pipeline remains responsible for grounding, Ownership, Final Adjudicator, and analysis_findings persistence");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
