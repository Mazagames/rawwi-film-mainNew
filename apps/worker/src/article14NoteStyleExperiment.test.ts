import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const { config } = await import("./config.js");
  const { runEventCandidateRunner } = await import("./eventCandidateRunner.js");

  assert(config.V5_ARTICLE_14_NOTE_STYLE_EXPERIMENT_ENABLED === false, "Article 14 experiment must default OFF");

  const events = [
    { event_id: 50, event_summary: "shoe threat", actor: "a", target: "b", action: "threatens to hit", intent: "anger", consequence: "fear", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "violence" },
    { event_id: 52, event_summary: "mild insult", actor: "a", target: "b", action: "insults", intent: "anger", consequence: "tension", quote: "لا تتفلسفين", start_offset: 28, end_offset: 40, dominant_meaning: "insult" },
    { event_id: 53, event_summary: "child-directed insult", actor: "a", target: "child", action: "insults", intent: "discipline", consequence: "fear", quote: "قوم يا عديم التربية", start_offset: 41, end_offset: 61, dominant_meaning: "child abuse" },
  ] as any;
  const chunkText = events.map((event) => event.quote).join("\n");
  const result = await runEventCandidateRunner({
    chunkText,
    eventUnderstanding: { chunk_start: 0, chunk_end: chunkText.length, event_count: events.length, events },
    articleNumbers: [14],
    notesStyleProviderResolution: true,
    experimentLabel: "article_14_note_style_test",
    reviewerResponse: async () => JSON.stringify({
      findings: events.map((event) => ({
        article_id: 14,
        event_id: event.event_id,
        title_ar: "إهانة شخصية",
        rationale_ar: "مرشح عالي الاستدعاء مرتبط بالحدث.",
        evidence_snippet: event.quote,
        atom_id: event.event_id === 50 ? 14 : "14-1",
        confidence: 0.9,
      })),
    }),
    finalAdjudicator: async (rows) => rows.filter((row) => row.location?.v3?.event_id !== 52),
  });

  assert(result.passResults.length === 1 && result.passResults[0]?.passName === "v5_article_14", "experiment must execute only Article 14");
  assert(result.rawCandidateCount === 3, `expected 3 raw candidates, got ${result.rawCandidateCount}`);
  assert(result.parsedCandidateCount === 3, `expected 3 parsed candidates, got ${result.parsedCandidateCount}`);
  assert(result.passResults.length === 1, "expected one Article 14 pass result");
  assert(result.groundedCandidateCount === 3, `expected 3 grounded candidates, got ${result.groundedCandidateCount}`);
  assert(result.groundedCandidates.find((finding) => finding.event_id === 50)?.atom_id === "14", "numeric atom_id must normalize to string 14");
  assert(result.groundedCandidates.find((finding) => finding.event_id === 52)?.atom_id === "14-1", "string atom_id must remain unchanged");
  assert(result.ownershipSurvivorCount === 3, `expected 3 Ownership survivors, got ${result.ownershipSurvivorCount}`);
  assert(result.finalAdjudicatorSurvivorCount === 2, `expected 2 Final Adjudicator survivors, got ${result.finalAdjudicatorSurvivorCount}`);
  assert(result.groundedCandidateCount === result.groundedCandidates.length, "all generated Article 14 candidates must be grounded");
  assert(result.groundedCandidates.every((finding) => events.some((event) => event.event_id === finding.event_id && event.quote === finding.evidence_snippet)), "evidence must remain exact and event-bound");
  assert(result.findings.some((finding) => finding.location?.v3?.event_id === 50), "candidate 1 should reach the final finding path");
  assert(result.findings.some((finding) => finding.location?.v3?.event_id === 53), "candidate 3 should reach the final finding path");
  assert(!result.findings.some((finding) => finding.location?.v3?.event_id === 52), "candidate 2 may be rejected by Final Adjudicator");
  assert(result.findings.every((finding) => finding.article_id === 14 && typeof finding.location?.v3?.event_id === "number"), "final result must be analysis_findings-compatible");

  console.log("✓ Article 14 Notes-style experiment is default-OFF and feature-gated");
  console.log("✓ Article 14 counts: raw 3 -> parsed 3 -> grounded 3 -> Ownership 3 -> Adjudicator 2");
  console.log("✓ Article 14 exact event_id/evidence preserved into analysis_findings-compatible output");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
