/**
 * Tests for the reviewer trace debug report.
 * Run: npx tsx src/reviewerTrace.test.ts
 */
import type { EventUnderstandingPassResult } from "./eventUnderstanding.js";
import { buildReviewerTraceReport, toReviewerTraceLog } from "./reviewerTrace.js";
import { buildValidatorAuditReport } from "./validatorAudit.js";
import type { JudgeFinding } from "./schemas.js";
import type { PassResult } from "./multiPassJudge.js";

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
    chunk_end: 50,
    event_count: 2,
    events: [
      {
        event_id: 1,
        actor: "سامي",
        target: "الحي",
        action: "ينفجر",
        intent: "حدث سردي",
        consequence: "غير مذكور صراحة",
        quote: "انفجار هز الحي في الشارع",
        start_offset: 0,
        end_offset: 25,
        dominant_meaning: "حدث سردي",
      },
      {
        event_id: 2,
        actor: "صراخ",
        target: "الزقاق",
        action: "متوتر",
        intent: "انفعال درامي",
        consequence: "استجابة انفعالية",
        quote: "صراخ متوتر في الزقاق",
        start_offset: 27,
        end_offset: 47,
        dominant_meaning: "انفعال درامي",
      },
    ],
  };
}

function testReviewerTraceReport(): void {
  const understanding = buildSyntheticUnderstanding();
  const acceptedFinding = buildFinding({
    evidence_snippet: "انفجار هز الحي في الشارع",
    rationale_ar: "العبارة تصف انفجاراً في الحي.",
    location: { start_offset: 0, end_offset: 24, start_line: 1, end_line: 1 },
  });
  const rejectedFinding = buildFinding({
    evidence_snippet: "صراخ متوتر في الزقاق",
    rationale_ar: "هذا تحريض على الفوضى.",
    location: { start_offset: 27, end_offset: 47, start_line: 1, end_line: 1 },
  });
  const passResults: PassResult[] = [
    {
      passName: "v5_article_03",
      duration: 18,
      findings: [acceptedFinding, rejectedFinding],
    },
  ];

  const validatorAuditReport = buildValidatorAuditReport({
    chunkStart: 0,
    chunkEnd: 50,
    chunkText: "انفجار هز الحي في الشارع. ثم صراخ متوتر في الزقاق.",
    eventUnderstanding: understanding,
    passResults,
    finalFindings: [
      {
        article_id: acceptedFinding.article_id,
        detection_pass: acceptedFinding.detection_pass,
        evidence_snippet: acceptedFinding.evidence_snippet,
        location: acceptedFinding.location,
      },
    ],
    memory2Enabled: false,
    useEventConsistencyChecks: true,
  });

  const report = buildReviewerTraceReport({
    chunkStart: 0,
    chunkEnd: 50,
    eventUnderstanding: understanding,
    passResults,
    finalFindings: [acceptedFinding],
    validatorAuditReport,
  });

  const log = toReviewerTraceLog(report);
  const row = report.reviewerRows[0];

  assert(report.summary.totalReviewers === 1, `expected one reviewer row, got ${report.summary.totalReviewers}`);
  assert(report.summary.totalEvents === 2, `expected two structured events, got ${report.summary.totalEvents}`);
  assert(row != null, "expected one reviewer trace row");
  assert(row.eventsReceivedCount === 2, `expected two received events, got ${row.eventsReceivedCount}`);
  assert(row.eventsAcceptedCount === 1, `expected one accepted event, got ${row.eventsAcceptedCount}`);
  assert(row.eventsIgnoredCount === 1, `expected one ignored event, got ${row.eventsIgnoredCount}`);
  assert(row.findings.length === 2, `expected accepted and rejected finding entries, got ${row.findings.length}`);
  assert(row.findings[0]?.selectedEvent?.eventId === 1, "expected the accepted finding to carry its selected event");
  assert(row.findings[0]?.verifierResult.status === "accepted", "expected first finding to be accepted");
  assert(row.findings[1]?.selectedEvent?.eventId === 2, "expected the rejected finding to carry its selected event");
  assert(row.findings[1]?.verifierResult.status === "rejected", "expected second finding to be rejected");
  assert(row.findings[1]?.verifierResult.reason === "event_rationale_mismatch" || row.findings[1]?.verifierResult.reason === "event_not_supported", "expected event-based rejection reason");
  assert(Object.keys(log.reviewerRows[0]?.eventsReceived[0] ?? {}).sort().join(",") === "dominantMeaning,eventId,quote", "expected compact structured event summaries");
  assert(Object.keys(log.reviewerRows[0]?.findings[0] ?? {}).sort().join(",") === "evidenceSelected,eventId,eventQuote,ownershipJustification,selectedEvent,verifierResult", "expected structured finding trace entries");
  console.log("✓ reviewer trace report captures structured reviewer debugging data");
}

async function main(): Promise<void> {
  testReviewerTraceReport();
  console.log("\nReviewer trace tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
