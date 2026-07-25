import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import { findBestEventMatch } from "./eventConsistency.js";
import type { PassResult } from "./multiPassJudge.js";
import type { JudgeFinding } from "./schemas.js";
import type { ValidatorAuditReport } from "./validatorAudit.js";
import type { ReviewerDecisionAudit } from "./reviewerBenchmark.js";
import { getV5ReviewerDefinitions, type V5ReviewerDefinition } from "./v5PromptPack.js";

export type ReviewerTraceEventSummary = {
  eventId: number;
  quote: string;
  dominantMeaning: string;
};

export type ReviewerTraceFindingEntry = {
  selectedEvent: ReviewerTraceEventSummary | null;
  eventId: number | null;
  eventQuote: string;
  evidenceSelected: string;
  ownershipJustification: string;
  reviewerArticleId: number;
  expectedArticleId: number | null;
  claimedArticleId: number | null;
  acceptedByVerifier: boolean;
  ownershipCorrect: boolean;
  snippetCorrect: boolean;
  explanationCorrect: boolean;
  confidence: number;
  verifierResult: {
    status: "accepted" | "rejected";
    validationStage: string | null;
    reason: string | null;
  };
};

export type ReviewerTraceRow = {
  articleNumber: number;
  articleTitle: string;
  passName: string;
  eventsReceivedCount: number;
  eventsReceived: ReviewerTraceEventSummary[];
  eventsAcceptedCount: number;
  eventsAcceptedIds: number[];
  eventsIgnoredCount: number;
  eventsIgnoredIds: number[];
  findingsEmitted: number;
  verifierAccepted: number;
  verifierRejected: number;
  findings: ReviewerTraceFindingEntry[];
};

export type ReviewerTraceReport = {
  traceVersion: "v1";
  chunkStart: number;
  chunkEnd: number;
  reviewerRows: ReviewerTraceRow[];
  summary: {
    totalReviewers: number;
    totalEvents: number;
    totalFindingsEmitted: number;
    totalVerifierAccepted: number;
    totalVerifierRejected: number;
  };
};

type FindingLike = Pick<
  JudgeFinding,
  "article_id" | "detection_pass" | "evidence_snippet" | "location" | "rationale_ar" | "title_ar" | "description_ar"
> & {
  start_offset_global?: number | null;
  end_offset_global?: number | null;
};

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function parsePassArticleNumber(passName: string): number | null {
  const match = /^v5_article_(\d{2})$/i.exec(passName.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function summarizeEvents(events: StructuredEvent[]): ReviewerTraceEventSummary[] {
  return events.map((event) => ({
    eventId: event.event_id,
    quote: event.quote,
    dominantMeaning: event.dominant_meaning,
  }));
}

function buildOwnershipJustification(articleNumber: number, event: StructuredEvent | null): string {
  if (!event) {
    return `هذا الحدث لا يثبت ملكية المادة ${String(articleNumber).padStart(2, "0")} بوضوح.`;
  }
  return `هذا الحدث يُنسب إلى المادة ${String(articleNumber).padStart(2, "0")} لأنه يصف ${event.dominant_meaning} عبر العبارة: «${event.quote}».`;
}

function buildRejectedJustification(articleNumber: number, reason: string): string {
  const reasonText =
    reason === "event_not_supported"
      ? "لم يجد التحقق النهائي حدثاً واضحاً يثبت هذه المخالفة"
      : reason === "event_ambiguous"
        ? "كان الحدث ملتبساً ولم يحسمه التحقق النهائي"
        : "لم يجتز الحدث التحقق النهائي";
  return `هذا الحدث لا يُسند إلى المادة ${String(articleNumber).padStart(2, "0")} لأن ${reasonText}.`;
}

function buildFindingEntryFromAudit(
  articleNumber: number,
  events: StructuredEvent[],
  audit: ReviewerDecisionAudit,
): ReviewerTraceFindingEntry {
  const matchedEvent = events.find((event) => event.event_id === audit.eventId) ?? null;
  return {
    selectedEvent: matchedEvent
      ? {
          eventId: matchedEvent.event_id,
          quote: matchedEvent.quote,
          dominantMeaning: matchedEvent.dominant_meaning,
        }
      : null,
    eventId: audit.eventId,
    eventQuote: audit.eventQuote,
    evidenceSelected: audit.findingEvidence,
    ownershipJustification: buildOwnershipJustification(articleNumber, matchedEvent),
    reviewerArticleId: audit.reviewerArticleId,
    expectedArticleId: audit.expectedArticleId,
    claimedArticleId: audit.claimedArticleId,
    acceptedByVerifier: audit.acceptedByVerifier,
    ownershipCorrect: audit.ownershipCorrect,
    snippetCorrect: audit.snippetCorrect,
    explanationCorrect: audit.explanationCorrect,
    confidence: audit.confidence,
    verifierResult: {
      status: audit.decision,
      validationStage: null,
      reason: audit.decision === "accepted" ? null : audit.reason,
    },
  };
}

function buildAcceptedFindingEntries(
  passName: string,
  articleNumber: number,
  events: StructuredEvent[],
  finalFindings: FindingLike[],
): ReviewerTraceFindingEntry[] {
  return finalFindings
    .filter((finding) => finding.detection_pass === passName)
    .map((finding) => {
      const match = findBestEventMatch(finding, events);
      return {
        selectedEvent: match.matchedEvent
          ? {
              eventId: match.matchedEvent.event_id,
              quote: match.matchedEvent.quote,
              dominantMeaning: match.matchedEvent.dominant_meaning,
            }
          : null,
        eventId: match.matchedEvent?.event_id ?? null,
        eventQuote: match.matchedEvent?.quote ?? "",
        evidenceSelected: String(finding.evidence_snippet ?? ""),
        ownershipJustification: buildOwnershipJustification(articleNumber, match.matchedEvent),
        reviewerArticleId: articleNumber,
        expectedArticleId: articleNumber,
        claimedArticleId: finding.article_id ?? null,
        acceptedByVerifier: true,
        ownershipCorrect: true,
        snippetCorrect: true,
        explanationCorrect: true,
        confidence: 1,
        verifierResult: {
          status: "accepted",
          validationStage: null,
          reason: null,
        },
      };
    });
}

function buildRejectedFindingEntries(
  articleNumber: number,
  events: StructuredEvent[],
  rejectionRows: ValidatorAuditReport["rejectionRows"],
): ReviewerTraceFindingEntry[] {
  return rejectionRows.map((row) => {
    const matchedEvent = row.eventId == null ? null : events.find((event) => event.event_id === row.eventId) ?? null;
    return {
      selectedEvent: matchedEvent
        ? {
            eventId: matchedEvent.event_id,
            quote: matchedEvent.quote,
            dominantMeaning: matchedEvent.dominant_meaning,
          }
        : null,
      eventId: row.eventId,
      eventQuote: row.eventQuote,
      evidenceSelected: row.evidenceSnippet,
      ownershipJustification: buildRejectedJustification(articleNumber, row.rejectionReason),
      reviewerArticleId: articleNumber,
      expectedArticleId: row.eventId == null ? null : articleNumber,
      claimedArticleId: articleNumber,
      acceptedByVerifier: false,
      ownershipCorrect: false,
      snippetCorrect: false,
      explanationCorrect: false,
      confidence: 0,
      verifierResult: {
        status: "rejected",
        validationStage: row.validationStage,
        reason: row.rejectionReason,
      },
    };
  });
}

function dedupeEvents(events: ReviewerTraceFindingEntry[]): ReviewerTraceFindingEntry[] {
  const seen = new Set<string>();
  const out: ReviewerTraceFindingEntry[] = [];
  for (const item of events) {
    const key = `${item.verifierResult.status}|${item.eventId ?? "null"}|${normalizeText(item.evidenceSelected)}|${item.verifierResult.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resolveReviewerMeta(articleNumber: number, reviewers: V5ReviewerDefinition[]): { articleTitle: string } {
  return {
    articleTitle: reviewers.find((reviewer) => reviewer.articleNumber === articleNumber)?.articleTitle ?? `Article ${String(articleNumber).padStart(2, "0")}`,
  };
}

export function buildReviewerTraceReport(args: {
  chunkStart: number;
  chunkEnd: number;
  eventUnderstanding: EventUnderstandingPassResult | null;
  passResults: PassResult[];
  finalFindings: FindingLike[];
  validatorAuditReport: ValidatorAuditReport;
  decisionAudits?: ReviewerDecisionAudit[] | null;
  reviewers?: V5ReviewerDefinition[];
}): ReviewerTraceReport {
  const reviewers = args.reviewers ?? getV5ReviewerDefinitions();
  const events = args.eventUnderstanding?.events ?? [];
  const summaryEvents = summarizeEvents(events);
  const reviewerRows: ReviewerTraceRow[] = [];

  for (const passResult of args.passResults) {
    const articleNumber = parsePassArticleNumber(passResult.passName);
    if (articleNumber == null) continue;

    const meta = resolveReviewerMeta(articleNumber, reviewers);
    const reviewerDecisionAudits = (args.decisionAudits ?? []).filter((audit) => audit.reviewerArticleId === articleNumber);
    const useDecisionAudits = reviewerDecisionAudits.length > 0;
    const acceptedFindings = args.finalFindings.filter((finding) => finding.detection_pass === passResult.passName);
    const acceptedEventIds = [...new Set(
      useDecisionAudits
        ? reviewerDecisionAudits.filter((audit) => audit.decision === "accepted").map((audit) => audit.eventId)
        : acceptedFindings
            .map((finding) => findBestEventMatch(finding, events).matchedEvent?.event_id ?? null)
            .filter((value): value is number => typeof value === "number"),
    )].sort((a, b) => a - b);
    const rejectedRows = args.validatorAuditReport.rejectionRows.filter((row) => row.reviewerPassName === passResult.passName);

    const findings = dedupeEvents(
      useDecisionAudits
        ? reviewerDecisionAudits.map((audit) => buildFindingEntryFromAudit(articleNumber, events, audit))
        : [
            ...buildAcceptedFindingEntries(passResult.passName, articleNumber, events, acceptedFindings),
            ...buildRejectedFindingEntries(articleNumber, events, rejectedRows),
          ],
    );

    reviewerRows.push({
      articleNumber,
      articleTitle: meta.articleTitle,
      passName: passResult.passName,
      eventsReceivedCount: summaryEvents.length,
      eventsReceived: summaryEvents,
      eventsAcceptedCount: acceptedEventIds.length,
      eventsAcceptedIds: acceptedEventIds,
      eventsIgnoredCount: Math.max(0, summaryEvents.length - acceptedEventIds.length),
      eventsIgnoredIds: summaryEvents
        .map((event) => event.eventId)
        .filter((eventId) => !acceptedEventIds.includes(eventId)),
      findingsEmitted: useDecisionAudits ? reviewerDecisionAudits.length : passResult.findings.length,
      verifierAccepted: useDecisionAudits
        ? reviewerDecisionAudits.filter((audit) => audit.decision === "accepted").length
        : acceptedFindings.length,
      verifierRejected: useDecisionAudits
        ? reviewerDecisionAudits.filter((audit) => audit.decision === "rejected").length
        : rejectedRows.length,
      findings,
    });
  }

  return {
    traceVersion: "v1",
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
    reviewerRows,
    summary: {
      totalReviewers: reviewerRows.length,
      totalEvents: summaryEvents.length,
      totalFindingsEmitted: reviewerRows.reduce((sum, row) => sum + row.findingsEmitted, 0),
      totalVerifierAccepted: reviewerRows.reduce((sum, row) => sum + row.verifierAccepted, 0),
      totalVerifierRejected: reviewerRows.reduce((sum, row) => sum + row.verifierRejected, 0),
    },
  };
}

export function toReviewerTraceLog(report: ReviewerTraceReport): Record<string, unknown> {
  return {
    traceVersion: report.traceVersion,
    chunkStart: report.chunkStart,
    chunkEnd: report.chunkEnd,
    summary: report.summary,
    reviewerRows: report.reviewerRows.map((row) => ({
      articleNumber: row.articleNumber,
      articleTitle: row.articleTitle,
      passName: row.passName,
      eventsReceivedCount: row.eventsReceivedCount,
      eventsReceived: row.eventsReceived,
      eventsAcceptedCount: row.eventsAcceptedCount,
      eventsAcceptedIds: row.eventsAcceptedIds,
      eventsIgnoredCount: row.eventsIgnoredCount,
      eventsIgnoredIds: row.eventsIgnoredIds,
      findingsEmitted: row.findingsEmitted,
      verifierAccepted: row.verifierAccepted,
      verifierRejected: row.verifierRejected,
      findings: row.findings.map((finding) => ({
        selectedEvent: finding.selectedEvent,
        eventId: finding.eventId,
        eventQuote: finding.eventQuote,
        evidenceSelected: finding.evidenceSelected,
        ownershipJustification: finding.ownershipJustification,
        reviewerArticleId: finding.reviewerArticleId,
        expectedArticleId: finding.expectedArticleId,
        claimedArticleId: finding.claimedArticleId,
        acceptedByVerifier: finding.acceptedByVerifier,
        ownershipCorrect: finding.ownershipCorrect,
        snippetCorrect: finding.snippetCorrect,
        explanationCorrect: finding.explanationCorrect,
        confidence: finding.confidence,
        verifierResult: finding.verifierResult,
      })),
    })),
  };
}
