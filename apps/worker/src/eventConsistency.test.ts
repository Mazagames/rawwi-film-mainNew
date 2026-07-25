/**
 * Tests for event-consistency validation.
 * Run: npx tsx src/eventConsistency.test.ts
 */
import type { EventUnderstandingPassResult } from "./eventUnderstanding.js";
import { getEventConsistencyIssue } from "./eventConsistency.js";
import type { JudgeFinding } from "./schemas.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function buildFinding(overrides: Partial<JudgeFinding>): JudgeFinding {
  return {
    article_id: 3,
    atom_id: null,
    canonical_atom: "NATIONAL_SECURITY",
    canonical_atoms: null,
    intensity: null,
    context_impact: null,
    legal_sensitivity: null,
    audience_risk: null,
    title_ar: "مؤشر أمني",
    description_ar: "انفجار هز الحي",
    severity: "medium",
    confidence: 0.95,
    is_interpretive: false,
    depiction_type: "unknown",
    speaker_role: "unknown",
    narrative_consequence: "unknown",
    context_window_id: null,
    context_confidence: null,
    lexical_confidence: null,
    policy_confidence: null,
    rationale_ar: "هز الانفجار الحي",
    final_ruling: "needs_review",
    detection_pass: "v5_article_03",
    evidence_snippet: "انفجار",
    location: {
      start_offset: 0,
      end_offset: 7,
      start_line: 1,
      end_line: 1,
    },
    ...overrides,
  };
}

function buildSyntheticUnderstanding(): EventUnderstandingPassResult {
  return {
    chunk_start: 0,
    chunk_end: 26,
    event_count: 1,
    events: [
      {
        event_id: 1,
        event_summary: "Explosion shakes a neighborhood.",
        actor: "انفجار",
        target: "الحي",
        action: "هز",
        intent: "حدث سردي",
        consequence: "غير مذكور صراحة",
        quote: "انفجار هز الحي في الشارع",
        start_offset: 0,
        end_offset: 25,
        dominant_meaning: "حدث سردي",
      },
    ],
  };
}

function testSupportedEventPasses(): void {
  const understanding = buildSyntheticUnderstanding();
  const finding = buildFinding({});
  const result = getEventConsistencyIssue(finding, understanding.events);
  assert(result.issue === null, `expected no issue, got ${result.issue}`);
  assert(result.matchedEvent != null, "expected a matched event");
  assert(result.matchedEvent?.quote.includes("انفجار"), "matched event should include the quote");
  console.log("✓ supported finding passes event consistency");
}

function testMismatchedRationaleFails(): void {
  const understanding = buildSyntheticUnderstanding();
  const finding = buildFinding({
    rationale_ar: "هذا تحريض على الفوضى",
    evidence_snippet: "انفجار",
  });
  const result = getEventConsistencyIssue(finding, understanding.events);
  assert(result.issue === "event_rationale_mismatch" || result.issue === "event_not_supported", `expected event mismatch, got ${result.issue}`);
  console.log("✓ mismatched rationale is rejected");
}

async function main(): Promise<void> {
  testSupportedEventPasses();
  testMismatchedRationaleFails();
  console.log("\nEvent consistency tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
