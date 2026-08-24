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
  const sharedDefinitions = definitions.filter((definition) =>
    definition.kind === "note" || ["article_05_violence_torture", "article_12_child_protection_exploitation", "article_14_profanity_personal_insults"].includes(definition.id),
  );
  assert(sharedDefinitions.length === 10, `expected 7 Notes plus 3 violation reviewers, got ${sharedDefinitions.length}`);
  assert(config.V5_SHARED_REVIEWER_PACK_ENABLED === false, "shared reviewer-pack migration must remain default-OFF");

  const events = [
    { event_id: 50, event_summary: "threat", actor: "a", target: "b", action: "threatens to hit", intent: "anger", consequence: "fear", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "violence" },
    { event_id: 52, event_summary: "insult", actor: "a", target: "b", action: "insults", intent: "anger", consequence: "tension", quote: "لا تتفلسفين", start_offset: 28, end_offset: 40, dominant_meaning: "insult" },
    { event_id: 53, event_summary: "child insult", actor: "a", target: "child", action: "insults", intent: "discipline", consequence: "fear", quote: "قوم يا عديم التربية", start_offset: 41, end_offset: 61, dominant_meaning: "child abuse" },
  ] as any;
  const eventUnderstanding = { chunk_start: 0, chunk_end: 100, event_count: events.length, events };
  const chunkText = events.map((event) => event.quote).join("\n");
  const responseByReviewer: Record<string, unknown> = {
    article_05_violence_torture: { findings: [{ article_id: 5, event_id: 50, title_ar: "عنف", rationale_ar: "تهديد", evidence_snippet: events[0].quote, confidence: 0.9 }] },
    article_12_child_protection_exploitation: { findings: [{ article_id: 12, event_id: 53, title_ar: "حماية طفل", rationale_ar: "إهانة طفل", evidence_snippet: events[2].quote, confidence: 0.9 }] },
    article_14_profanity_personal_insults: { findings: [
      { article_id: 14, event_id: 52, title_ar: "إهانة", rationale_ar: "إهانة شخصية", evidence_snippet: events[1].quote, confidence: 0.9 },
      { article_id: 14, event_id: 53, title_ar: "إهانة", rationale_ar: "إهانة شخصية", evidence_snippet: events[2].quote, confidence: 0.9 },
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
  assert(violations.length === 4, `expected 4 raw violation candidates, got ${violations.length}`);
  assert(violations.every((finding) => typeof finding.article_id === "number" && typeof finding.event_id === "number"), "violation candidates must preserve article_id and event_id");
  assert(violations.every((finding) => events.some((event) => event.event_id === finding.event_id && event.quote === finding.evidence_snippet)), "violation evidence must remain exact");
  assert(result.notes.length === 0, "violation candidates must not be emitted as Notes");
  assert(result.passResults.filter((pass) => ["article_05_violence_torture", "article_12_child_protection_exploitation", "article_14_profanity_personal_insults"].includes(pass.passName)).length === 3, "all three violation reviewers must use the shared pass result");
  console.log("✓ shared reviewer-pack executor runs Articles 5, 12, and 14 with JudgeFinding-compatible candidates");
  console.log("✓ shared output preserves exact event_id/evidence and keeps violation output out of analysis_notes");
  console.log("✓ existing pipeline remains responsible for grounding, Ownership, Final Adjudicator, and analysis_findings persistence");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
