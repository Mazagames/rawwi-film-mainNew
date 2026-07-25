/**
 * Tests for the validator audit report.
 * Run: npx tsx src/validatorAudit.test.ts
 */
import type { EventUnderstandingPassResult } from "./eventUnderstanding.js";
import { buildValidatorAuditHtml, buildValidatorAuditReport } from "./validatorAudit.js";
import type { PassResult } from "./multiPassJudge.js";
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
    description_ar: "انفجار",
    severity: "medium",
    confidence: 0.92,
    is_interpretive: false,
    depiction_type: "unknown",
    speaker_role: "unknown",
    narrative_consequence: "unknown",
    context_window_id: null,
    context_confidence: null,
    lexical_confidence: null,
    policy_confidence: null,
    rationale_ar: "وقع انفجار في الحي",
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
    chunk_end: 25,
    event_count: 1,
    events: [
      {
        event_id: 1,
        actor: "الانفجار",
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

function testValidatorAuditCountsEventConsistencyPass(): void {
  const chunk = "انفجار هز الحي في الشارع.";
  const eventUnderstanding = buildSyntheticUnderstanding();
  const passResults: PassResult[] = [
    {
      passName: "v5_article_03",
      duration: 12,
      findings: [buildFinding({})],
    },
  ];

  const report = buildValidatorAuditReport({
    chunkStart: 0,
    chunkEnd: chunk.length,
    chunkText: chunk,
    eventUnderstanding,
    passResults,
    finalFindings: [],
    memory2Enabled: false,
    useEventConsistencyChecks: true,
  });

  const eventRow = report.ruleRows.find((row) => row.rule === "event_not_supported");
  assert(eventRow != null, "expected event_not_supported row");
  assert(eventRow.falseRejects === 0, `expected zero false rejects, got ${eventRow.falseRejects}`);
  assert(report.summary.totalFalseRejects === 0, `expected total false rejects 0, got ${report.summary.totalFalseRejects}`);
  assert(report.rejectionRows.length === 0, "expected no rejected finding record");
  console.log("✓ validator audit keeps a supported V5 finding");
}

function testValidatorAuditReportsEventMismatch(): void {
  const chunk = "انفجار هز الحي في الشارع.";
  const eventUnderstanding = buildSyntheticUnderstanding();
  const passResults: PassResult[] = [
    {
      passName: "v5_article_03",
      duration: 12,
      findings: [buildFinding({ rationale_ar: "هذا تحريض على الفوضى" })],
    },
  ];
  const report = buildValidatorAuditReport({
    chunkStart: 0,
    chunkEnd: chunk.length,
    chunkText: chunk,
    eventUnderstanding,
    passResults,
    finalFindings: [],
    memory2Enabled: false,
    useEventConsistencyChecks: true,
  });
  const html = buildValidatorAuditHtml(report);
  assert(html.includes("Validator Audit Dashboard"), "HTML should include the dashboard title");
  assert(html.includes("Event consistency"), "HTML should include the event consistency section");
  assert(report.rejectionRows[0]?.rule === "event_rationale_mismatch" || report.rejectionRows[0]?.rule === "event_not_supported", "expected event-based rejection");
  console.log("✓ validator audit reports an event mismatch");
}

async function main(): Promise<void> {
  testValidatorAuditCountsEventConsistencyPass();
  testValidatorAuditReportsEventMismatch();
  console.log("\nValidator audit tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
