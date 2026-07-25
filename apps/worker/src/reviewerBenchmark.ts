import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import type { PassResult } from "./multiPassJudge.js";
import { getV5ReviewerDefinitions, type V5ReviewerDefinition } from "./v5PromptPack.js";

type ReviewerBenchmarkFindingLike = {
  article_id?: number | null;
  detection_pass?: string | null;
  confidence?: number | null;
  evidence_snippet?: string | null;
  rationale_ar?: string | null;
  title_ar?: string | null;
  description_ar?: string | null;
  location?: {
    start_offset?: number | null;
    end_offset?: number | null;
  } | null;
};

export type ReviewerBenchmarkIssue = {
  eventId: number;
  eventQuote: string;
  ownerArticleId: number | null;
  reviewerArticleId: number;
  reviewerPassName: string;
  claimArticleId: number | null;
  evidenceSnippet: string;
  rationaleAr: string | null;
  verifierStatus: "accepted" | "rejected";
};

export type ReviewerBenchmarkMiss = {
  eventId: number;
  eventQuote: string;
  ownerArticleId: number;
  reason: "ownership rejected" | "no finding returned";
};

export type ReviewerBenchmarkReviewerRow = {
  articleNumber: number;
  articleTitle: string;
  passName: string;
  eventsReceived: number;
  eventsAccepted: number;
  eventsRejected: number;
  eventsIgnored: number;
  findingsEmitted: number;
  verifierAccepted: number;
  verifierRejected: number;
  precision: number;
  recall: number;
  ownershipAccuracy: number;
  snippetAccuracy: number;
  explanationAccuracy: number;
  averageConfidence: number;
  acceptedEventIds: number[];
  ignoredEventIds: number[];
};

export type ReviewerDecisionAudit = {
  eventId: number;
  reviewerArticleId: number;
  reviewerPassName: string;
  expectedArticleId: number;
  claimedArticleId: number | null;
  decision: "accepted" | "rejected";
  reason: string;
  confidence: number;
  acceptedByVerifier: boolean;
  ownershipCorrect: boolean;
  snippetCorrect: boolean;
  explanationCorrect: boolean;
  eventQuote: string;
  findingEvidence: string;
  findingRationale: string | null;
};

export type ReviewerBenchmarkReport = {
  benchmarkVersion: "v1";
  chunkStart: number;
  chunkEnd: number;
  eventCount: number;
  reviewerRows: ReviewerBenchmarkReviewerRow[];
  reviewerRanking: ReviewerBenchmarkReviewerRow[];
  decisionAudits: ReviewerDecisionAudit[];
  falsePositives: ReviewerBenchmarkIssue[];
  falseNegatives: ReviewerBenchmarkMiss[];
  summary: {
    totalReviewers: number;
    totalEvents: number;
    totalFindingsEmitted: number;
    totalVerifierAccepted: number;
    totalVerifierRejected: number;
    averagePrecision: number;
    averageRecall: number;
    averageOwnershipAccuracy: number;
    averageSnippetAccuracy: number;
    averageExplanationAccuracy: number;
    averageConfidence: number;
  };
};

type MatchedFinding = {
  finding: ReviewerBenchmarkFindingLike;
  passName: string;
  passArticleId: number;
  event: StructuredEvent | null;
  score: number;
  kind: "raw" | "accepted";
};

const CONTENT_TOKEN_RE = /[\p{L}\p{N}]+/gu;
const STOPWORDS = new Set([
  "و", "في", "على", "إلى", "الى", "من", "عن", "أن", "إن", "كان", "كانت", "هذا", "هذه",
  "ذلك", "تلك", "ثم", "مع", "ما", "لا", "لم", "لن", "هو", "هي", "هم", "هن",
  "يا", "أو", "بل", "قد", "قد", "هناك", "هنا", "كل", "أي", "أيضاً", "ايضا",
]);

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return (normalizeText(value).match(CONTENT_TOKEN_RE) ?? [])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenize(value));
}

function combineEventText(event: StructuredEvent): string {
  return [
    event.quote,
    event.actor,
    event.target,
    event.action,
    event.intent,
    event.consequence,
    event.dominant_meaning,
  ]
    .filter(Boolean)
    .join(" ");
}

function combineFindingText(finding: ReviewerBenchmarkFindingLike): string {
  return [
    finding.evidence_snippet,
    finding.rationale_ar,
    finding.title_ar,
    finding.description_ar,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function parsePassArticleNumber(passName: string): number | null {
  const match = /^v5_article_(\d{2})$/i.exec(passName.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function resolveReviewerMeta(articleNumber: number, reviewerLookup: Map<number, V5ReviewerDefinition>): { articleTitle: string } {
  return {
    articleTitle: reviewerLookup.get(articleNumber)?.articleTitle ?? `Article ${String(articleNumber).padStart(2, "0")}`,
  };
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function scoreFindingAgainstEvent(finding: ReviewerBenchmarkFindingLike, event: StructuredEvent): number {
  const findingText = normalizeText(combineFindingText(finding));
  const eventText = normalizeText(combineEventText(event));
  if (!findingText || !eventText) return 0;

  const exactFinding = findingText === eventText;
  const exactQuote =
    normalizeText(String(finding.evidence_snippet ?? "")) === normalizeText(event.quote) ||
    eventText.includes(normalizeText(String(finding.evidence_snippet ?? ""))) ||
    normalizeText(String(finding.evidence_snippet ?? "")).includes(normalizeText(event.quote));
  if (exactFinding || exactQuote) return 100;

  let score = 0;

  const findingTokens = tokenSet(findingText);
  const eventTokens = tokenSet(eventText);
  let overlap = 0;
  for (const token of findingTokens) {
    if (eventTokens.has(token)) overlap++;
  }
  if (findingTokens.size > 0 && overlap > 0) {
    score += (overlap / findingTokens.size) * 45;
    score += (overlap / eventTokens.size) * 20;
  }

  const snippet = normalizeText(String(finding.evidence_snippet ?? ""));
  const quote = normalizeText(event.quote);
  if (snippet && quote && (quote.includes(snippet) || snippet.includes(quote))) {
    score += 30;
  }

  const rationale = normalizeText(String(finding.rationale_ar ?? ""));
  if (rationale) {
    const rationaleTokens = tokenSet(rationale);
    let rationaleOverlap = 0;
    for (const token of rationaleTokens) {
      if (eventTokens.has(token)) rationaleOverlap++;
    }
    if (rationaleTokens.size > 0) {
      score += (rationaleOverlap / rationaleTokens.size) * 20;
    }
  }

  const findingStart = finding.location?.start_offset ?? null;
  const findingEnd = finding.location?.end_offset ?? null;
  if (
    typeof findingStart === "number" &&
    typeof findingEnd === "number" &&
    typeof event.start_offset === "number" &&
    typeof event.end_offset === "number"
  ) {
    const overlap = overlapLength(findingStart, findingEnd, event.start_offset, event.end_offset);
    if (overlap > 0) {
      const minLen = Math.max(1, Math.min(findingEnd - findingStart, event.end_offset - event.start_offset));
      score += (overlap / minLen) * 35;
    }
  }

  if (normalizeText(event.action) && findingText.includes(normalizeText(event.action))) score += 15;
  if (normalizeText(event.actor) && findingText.includes(normalizeText(event.actor))) score += 6;
  if (normalizeText(event.target) && findingText.includes(normalizeText(event.target))) score += 6;

  return score;
}

function bestEventMatch(finding: ReviewerBenchmarkFindingLike, events: StructuredEvent[]): { event: StructuredEvent | null; score: number } {
  let bestEvent: StructuredEvent | null = null;
  let bestScore = 0;

  for (const event of events) {
    const score = scoreFindingAgainstEvent(finding, event);
    if (score > bestScore) {
      bestScore = score;
      bestEvent = event;
    }
  }

  return bestScore >= 40 ? { event: bestEvent, score: bestScore } : { event: null, score: bestScore };
}

function isSnippetSupportedByEvent(finding: ReviewerBenchmarkFindingLike, event: StructuredEvent): boolean {
  const snippet = normalizeText(String(finding.evidence_snippet ?? ""));
  const quote = normalizeText(event.quote);
  if (!snippet || !quote) return false;
  return quote.includes(snippet) || snippet.includes(quote);
}

function isExplanationSupportedByEvent(finding: ReviewerBenchmarkFindingLike, event: StructuredEvent): boolean {
  const rationale = normalizeText(String(finding.rationale_ar ?? ""));
  if (!rationale) return false;
  const rationaleTokens = tokenize(rationale);
  if (rationaleTokens.length === 0) return false;

  const eventTokens = tokenSet(combineEventText(event));
  let overlap = 0;
  for (const token of rationaleTokens) {
    if (eventTokens.has(token)) overlap++;
  }

  if (overlap === 0) return false;
  if (rationaleTokens.length <= 3) return true;
  return overlap / rationaleTokens.length >= 0.45;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function combineReviewerText(reviewer: V5ReviewerDefinition): string {
  return [reviewer.articleTitle, reviewer.displayLabel, reviewer.prompt].filter(Boolean).join(" ");
}

function scoreEventAgainstReviewer(event: StructuredEvent, reviewer: V5ReviewerDefinition): number {
  const eventText = normalizeText(combineEventText(event));
  const reviewerText = normalizeText(combineReviewerText(reviewer));
  if (!eventText || !reviewerText) return 0;

  const eventTokens = tokenSet(eventText);
  const reviewerTokens = tokenSet(reviewerText);
  let overlap = 0;
  for (const token of eventTokens) {
    if (reviewerTokens.has(token)) overlap++;
  }

  let score = 0;
  if (eventTokens.size > 0 && overlap > 0) {
    score += (overlap / eventTokens.size) * 50;
    score += (overlap / reviewerTokens.size) * 20;
  }

  const quote = normalizeText(event.quote);
  if (quote && reviewerText.includes(quote)) score += 30;
  const dominantMeaning = normalizeText(event.dominant_meaning);
  if (dominantMeaning && reviewerText.includes(dominantMeaning)) score += 18;
  const action = normalizeText(event.action);
  if (action && reviewerText.includes(action)) score += 12;
  const actor = normalizeText(event.actor);
  if (actor && reviewerText.includes(actor)) score += 6;
  const target = normalizeText(event.target);
  if (target && reviewerText.includes(target)) score += 6;

  return score;
}

function selectExpectedReviewerForEvent(
  event: StructuredEvent,
  reviewers: V5ReviewerDefinition[],
): { reviewer: V5ReviewerDefinition; score: number } {
  let bestReviewer = reviewers[0] ?? null;
  let bestScore = -1;

  for (const reviewer of reviewers) {
    const score = scoreEventAgainstReviewer(event, reviewer);
    if (score > bestScore) {
      bestScore = score;
      bestReviewer = reviewer;
    }
  }

  if (!bestReviewer) {
    throw new Error("Reviewer pack is empty");
  }

  return { reviewer: bestReviewer, score: bestScore };
}

function findBestFindingForEvent(
  findings: ReviewerBenchmarkFindingLike[],
  event: StructuredEvent,
): ReviewerBenchmarkFindingLike | null {
  let best: ReviewerBenchmarkFindingLike | null = null;
  let bestScore = 0;
  for (const finding of findings) {
    const score = scoreFindingAgainstEvent(finding, event);
    if (score > bestScore) {
      bestScore = score;
      best = finding;
    }
  }
  return bestScore >= 40 ? best : null;
}

function buildOwnershipReason(
  expectedReviewer: V5ReviewerDefinition,
  event: StructuredEvent,
  finding: ReviewerBenchmarkFindingLike | null,
  acceptedByVerifier: boolean,
): string {
  const articleLabel = `Article ${String(expectedReviewer.articleNumber).padStart(2, "0")}`;
  const quote = event.quote ? `«${event.quote}»` : "the structured event";
  if (acceptedByVerifier) {
    return `Primary ownership belongs to ${articleLabel} because ${quote} describes ${event.dominant_meaning}.`;
  }

  if (finding && finding.article_id != null && finding.article_id !== expectedReviewer.articleNumber) {
    return `Primary ownership belongs to ${articleLabel}, not Article ${String(finding.article_id).padStart(2, "0")}, because ${quote} describes ${event.dominant_meaning}.`;
  }

  return `Primary ownership belongs to ${articleLabel} because ${quote} describes ${event.dominant_meaning}, but this reviewer did not emit a surviving finding.`;
}

function buildReviewerDecisionAudits(args: {
  eventUnderstanding: EventUnderstandingPassResult | null;
  passResults: PassResult[];
  finalFindings: ReviewerBenchmarkFindingLike[];
  reviewers: V5ReviewerDefinition[];
}): ReviewerDecisionAudit[] {
  const events = args.eventUnderstanding?.events ?? [];
  const audits: ReviewerDecisionAudit[] = [];

  for (const passResult of args.passResults) {
    const reviewerArticleId = parsePassArticleNumber(passResult.passName);
    if (reviewerArticleId == null) continue;
    const reviewer = args.reviewers.find((item) => item.articleNumber === reviewerArticleId) ?? args.reviewers[0];
    if (!reviewer) continue;

    const reviewerFindings = passResult.findings;
    const acceptedFindings = args.finalFindings.filter((finding) => finding.detection_pass === passResult.passName);

    for (const event of events) {
      const expected = selectExpectedReviewerForEvent(event, args.reviewers);
      const expectedArticleId = expected.reviewer.articleNumber;
      const rawFinding = findBestFindingForEvent(reviewerFindings, event);
      const acceptedFinding = findBestFindingForEvent(acceptedFindings, event);
      const acceptedByVerifier = acceptedFinding != null;
      const claimedArticleId = rawFinding?.article_id ?? reviewerArticleId;
      const decision: "accepted" | "rejected" = acceptedByVerifier ? "accepted" : "rejected";
      const confidence = Number(Math.max(0.05, Math.min(0.99, expected.score / 100)).toFixed(2));
      const ownershipCorrect =
        reviewerArticleId === expectedArticleId
          ? acceptedByVerifier
          : !acceptedByVerifier;
      const snippetCorrect = Boolean(rawFinding && isSnippetSupportedByEvent(rawFinding, event));
      const explanationCorrect = Boolean(rawFinding && isExplanationSupportedByEvent(rawFinding, event));

      audits.push({
        eventId: event.event_id,
        reviewerArticleId,
        reviewerPassName: passResult.passName,
        expectedArticleId,
        claimedArticleId,
        decision,
        reason: buildOwnershipReason(expected.reviewer, event, rawFinding, acceptedByVerifier),
        confidence,
        acceptedByVerifier,
        ownershipCorrect,
        snippetCorrect,
        explanationCorrect,
        eventQuote: event.quote,
        findingEvidence: String(rawFinding?.evidence_snippet ?? ""),
        findingRationale: rawFinding?.rationale_ar ?? null,
      });
    }
  }

  return audits;
}

export function buildReviewerBenchmarkReport(args: {
  chunkStart: number;
  chunkEnd: number;
  eventUnderstanding: EventUnderstandingPassResult | null;
  passResults: PassResult[];
  finalFindings: ReviewerBenchmarkFindingLike[];
  reviewers?: V5ReviewerDefinition[];
}): ReviewerBenchmarkReport {
  const reviewerLookup = new Map<number, V5ReviewerDefinition>(
    (args.reviewers ?? getV5ReviewerDefinitions()).map((reviewer) => [reviewer.articleNumber, reviewer]),
  );
  const events = args.eventUnderstanding?.events ?? [];
  const eventCount = events.length;
  const decisionAudits = buildReviewerDecisionAudits({
    eventUnderstanding: args.eventUnderstanding,
    passResults: args.passResults,
    finalFindings: args.finalFindings,
    reviewers: Array.from(reviewerLookup.values()),
  });

  const rawMatches: MatchedFinding[] = [];
  for (const passResult of args.passResults) {
    const passArticleId = parsePassArticleNumber(passResult.passName);
    if (passArticleId == null) continue;
    for (const finding of passResult.findings) {
      const match = bestEventMatch(finding, events);
      rawMatches.push({
        finding,
        passName: passResult.passName,
        passArticleId,
        event: match.event,
        score: match.score,
        kind: "raw",
      });
    }
  }

  const acceptedMatches: MatchedFinding[] = [];
  for (const finding of args.finalFindings) {
    const passName = String(finding.detection_pass ?? "").trim();
    const passArticleId = parsePassArticleNumber(passName);
    if (passArticleId == null) continue;
    const match = bestEventMatch(finding, events);
    acceptedMatches.push({
      finding,
      passName,
      passArticleId,
      event: match.event,
      score: match.score,
      kind: "accepted",
    });
  }

  const allMatches = [...acceptedMatches, ...rawMatches];
  const acceptedByEvent = new Map<number, MatchedFinding[]>();
  const rawByEvent = new Map<number, MatchedFinding[]>();

  for (const match of allMatches) {
    if (!match.event) continue;
    const bucket = match.kind === "accepted" ? acceptedByEvent : rawByEvent;
    if (!bucket.has(match.event.event_id)) bucket.set(match.event.event_id, []);
    bucket.get(match.event.event_id)!.push(match);
  }

  const reviewerRows: ReviewerBenchmarkReviewerRow[] = [];
  const falsePositives: ReviewerBenchmarkIssue[] = [];
  const falseNegatives: ReviewerBenchmarkMiss[] = [];
  const falsePositiveKeys = new Set<string>();

  for (const passResult of args.passResults) {
    const articleNumber = parsePassArticleNumber(passResult.passName);
    if (articleNumber == null) continue;
    const meta = resolveReviewerMeta(articleNumber, reviewerLookup);
    const reviewerAudits = decisionAudits.filter((audit) => audit.reviewerArticleId === articleNumber);
    const acceptedDecisionAudits = reviewerAudits.filter((audit) => audit.decision === "accepted");
    const rejectedDecisionAudits = reviewerAudits.filter((audit) => audit.decision === "rejected");
    const acceptedEventIds = uniqueSortedNumbers(acceptedDecisionAudits.map((audit) => audit.eventId));
    const ignoredEventIds = uniqueSortedNumbers(rejectedDecisionAudits.map((audit) => audit.eventId));

    const verifierAccepted = acceptedDecisionAudits.length;
    const findingsEmitted = passResult.findings.length;
    const verifierRejected = rejectedDecisionAudits.length;
    const ownershipAccuracy = average(reviewerAudits.map((audit) => (audit.ownershipCorrect ? 1 : 0)));
    const snippetAccuracy = average(reviewerAudits.map((audit) => (audit.snippetCorrect ? 1 : 0)));
    const explanationAccuracy = average(reviewerAudits.map((audit) => (audit.explanationCorrect ? 1 : 0)));
    const averageConfidence = average(reviewerAudits.map((audit) => audit.confidence));

    reviewerRows.push({
      articleNumber,
      articleTitle: meta.articleTitle,
      passName: passResult.passName,
      eventsReceived: eventCount,
      eventsAccepted: acceptedEventIds.length,
      eventsRejected: rejectedDecisionAudits.length,
      eventsIgnored: rejectedDecisionAudits.length,
      findingsEmitted,
      verifierAccepted,
      verifierRejected,
      precision: findingsEmitted > 0 ? verifierAccepted / findingsEmitted : 0,
      recall: eventCount > 0 ? acceptedEventIds.length / eventCount : 0,
      ownershipAccuracy,
      snippetAccuracy,
      explanationAccuracy,
      averageConfidence,
      acceptedEventIds,
      ignoredEventIds,
    });
  }

  for (const audit of decisionAudits) {
    if (audit.decision === "accepted" && audit.expectedArticleId !== audit.reviewerArticleId) {
      const falsePositiveKey = [
        audit.reviewerPassName,
        audit.eventId,
        audit.expectedArticleId,
        audit.claimedArticleId ?? audit.reviewerArticleId,
        normalizeText(audit.findingEvidence),
      ].join("|");
      if (falsePositiveKeys.has(falsePositiveKey)) continue;
      falsePositiveKeys.add(falsePositiveKey);
      falsePositives.push({
        eventId: audit.eventId,
        eventQuote: audit.eventQuote,
        ownerArticleId: audit.expectedArticleId,
        reviewerArticleId: audit.reviewerArticleId,
        reviewerPassName: audit.reviewerPassName,
        claimArticleId: audit.claimedArticleId,
        evidenceSnippet: audit.findingEvidence,
        rationaleAr: audit.findingRationale,
        verifierStatus: audit.acceptedByVerifier ? "accepted" : "rejected",
      });
    }

    if (audit.reviewerArticleId === audit.expectedArticleId && audit.decision === "rejected") {
      falseNegatives.push({
        eventId: audit.eventId,
        eventQuote: audit.eventQuote,
        ownerArticleId: audit.expectedArticleId,
        reason: audit.findingEvidence.trim().length > 0 ? "ownership rejected" : "no finding returned",
      });
    }
  }

  const reviewerRanking = [...reviewerRows].sort((a, b) => {
    const ownershipDiff = a.ownershipAccuracy - b.ownershipAccuracy;
    if (ownershipDiff !== 0) return ownershipDiff;
    const precisionDiff = a.precision - b.precision;
    if (precisionDiff !== 0) return precisionDiff;
    const recallDiff = a.recall - b.recall;
    if (recallDiff !== 0) return recallDiff;
    return a.articleNumber - b.articleNumber;
  });

  const summary = {
    totalReviewers: reviewerRows.length,
    totalEvents: eventCount,
    totalFindingsEmitted: reviewerRows.reduce((sum, row) => sum + row.findingsEmitted, 0),
    totalVerifierAccepted: reviewerRows.reduce((sum, row) => sum + row.verifierAccepted, 0),
    totalVerifierRejected: reviewerRows.reduce((sum, row) => sum + row.verifierRejected, 0),
    averagePrecision: average(reviewerRows.map((row) => row.precision)),
    averageRecall: average(reviewerRows.map((row) => row.recall)),
    averageOwnershipAccuracy: average(reviewerRows.map((row) => row.ownershipAccuracy)),
    averageSnippetAccuracy: average(reviewerRows.map((row) => row.snippetAccuracy)),
    averageExplanationAccuracy: average(reviewerRows.map((row) => row.explanationAccuracy)),
    averageConfidence: average(reviewerRows.map((row) => row.averageConfidence)),
  };

  return {
    benchmarkVersion: "v1",
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
    eventCount,
    reviewerRows,
    reviewerRanking,
    decisionAudits,
    falsePositives,
    falseNegatives,
    summary,
  };
}

export function toReviewerBenchmarkLog(report: ReviewerBenchmarkReport): Record<string, unknown> {
  return {
    benchmarkVersion: report.benchmarkVersion,
    chunkStart: report.chunkStart,
    chunkEnd: report.chunkEnd,
    summary: report.summary,
    reviewerRows: report.reviewerRows.map((row) => ({
      articleNumber: row.articleNumber,
      articleTitle: row.articleTitle,
      passName: row.passName,
      eventsReceived: row.eventsReceived,
      eventsAccepted: row.eventsAccepted,
      eventsRejected: row.eventsRejected,
      eventsIgnored: row.eventsIgnored,
      findingsEmitted: row.findingsEmitted,
      verifierAccepted: row.verifierAccepted,
      verifierRejected: row.verifierRejected,
      precision: row.precision,
      recall: row.recall,
      ownershipAccuracy: row.ownershipAccuracy,
      snippetAccuracy: row.snippetAccuracy,
      explanationAccuracy: row.explanationAccuracy,
      averageConfidence: row.averageConfidence,
      acceptedEventIds: row.acceptedEventIds,
      ignoredEventIds: row.ignoredEventIds,
    })),
    reviewerRanking: report.reviewerRanking.map((row) => ({
      articleNumber: row.articleNumber,
      articleTitle: row.articleTitle,
      passName: row.passName,
      precision: row.precision,
      recall: row.recall,
      ownershipAccuracy: row.ownershipAccuracy,
      averageConfidence: row.averageConfidence,
    })),
    decisionAudits: report.decisionAudits.slice(0, 120),
    falsePositives: report.falsePositives.slice(0, 20),
    falseNegatives: report.falseNegatives.slice(0, 20),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPercent(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function renderMetricCard(label: string, value: string, subtitle?: string): string {
  return `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${subtitle ? `<div class="metric-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

function renderReviewerRows(rows: ReviewerBenchmarkReviewerRow[]): string {
  return rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(String(row.articleNumber).padStart(2, "0"))}</td>
        <td>${escapeHtml(row.articleTitle)}</td>
        <td>${escapeHtml(row.passName)}</td>
        <td>${formatInteger(row.eventsReceived)}</td>
        <td>${formatInteger(row.eventsAccepted)}</td>
        <td>${formatInteger(row.eventsRejected)}</td>
        <td>${formatInteger(row.eventsIgnored)}</td>
        <td>${formatInteger(row.findingsEmitted)}</td>
        <td>${formatInteger(row.verifierAccepted)}</td>
        <td>${formatInteger(row.verifierRejected)}</td>
        <td>${escapeHtml(formatPercent(row.precision))}</td>
        <td>${escapeHtml(formatPercent(row.recall))}</td>
        <td>${escapeHtml(formatPercent(row.ownershipAccuracy))}</td>
        <td>${escapeHtml(formatPercent(row.snippetAccuracy))}</td>
        <td>${escapeHtml(formatPercent(row.explanationAccuracy))}</td>
        <td>${escapeHtml(formatPercent(row.averageConfidence))}</td>
      </tr>
    `)
    .join("");
}

function renderReviewerRankingRows(rows: ReviewerBenchmarkReviewerRow[]): string {
  return rows
    .map((row, index) => `
      <tr>
        <td>${formatInteger(index + 1)}</td>
        <td>${escapeHtml(String(row.articleNumber).padStart(2, "0"))}</td>
        <td>${escapeHtml(row.articleTitle)}</td>
        <td>${escapeHtml(row.passName)}</td>
        <td>${escapeHtml(formatPercent(row.ownershipAccuracy))}</td>
        <td>${escapeHtml(formatPercent(row.precision))}</td>
        <td>${escapeHtml(formatPercent(row.recall))}</td>
        <td>${escapeHtml(formatPercent(row.averageConfidence))}</td>
      </tr>
    `)
    .join("");
}

function renderDecisionRows(rows: ReviewerDecisionAudit[], accepted: boolean): string {
  const filtered = rows.filter((row) => row.decision === (accepted ? "accepted" : "rejected"));
  if (filtered.length === 0) {
    return `<tr><td colspan="7" class="empty-state">No ${accepted ? "accepted" : "rejected"} events recorded.</td></tr>`;
  }

  return filtered
    .map((row) => `
      <tr>
        <td>${formatInteger(row.eventId)}</td>
        <td>${escapeHtml(String(row.reviewerArticleId).padStart(2, "0"))}</td>
        <td>${escapeHtml(String(row.expectedArticleId).padStart(2, "0"))}</td>
        <td>${escapeHtml(String(row.claimedArticleId ?? "n/a"))}</td>
        <td>${escapeHtml(row.eventQuote)}</td>
        <td>${escapeHtml(row.reason)}</td>
        <td>${escapeHtml(row.findingEvidence)}</td>
      </tr>
    `)
    .join("");
}

function renderFalsePositiveRows(rows: ReviewerBenchmarkIssue[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="9" class="empty-state">No false positives recorded.</td></tr>`;
  }

  return rows
    .map((row) => `
      <tr>
        <td>${formatInteger(row.eventId)}</td>
        <td>${escapeHtml(String(row.reviewerArticleId).padStart(2, "0"))}</td>
        <td>${escapeHtml(row.reviewerPassName)}</td>
        <td>${escapeHtml(String(row.claimArticleId ?? "n/a"))}</td>
        <td>${escapeHtml(String(row.ownerArticleId ?? "n/a"))}</td>
        <td>${escapeHtml(row.verifierStatus)}</td>
        <td>${escapeHtml(row.eventQuote)}</td>
        <td>${escapeHtml(row.evidenceSnippet)}</td>
        <td>${escapeHtml(row.rationaleAr ?? "")}</td>
      </tr>
    `)
    .join("");
}

function renderFalseNegativeRows(rows: ReviewerBenchmarkMiss[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4" class="empty-state">No false negatives recorded.</td></tr>`;
  }

  return rows
    .map((row) => `
      <tr>
        <td>${formatInteger(row.eventId)}</td>
        <td>${escapeHtml(String(row.ownerArticleId).padStart(2, "0"))}</td>
        <td>${escapeHtml(row.reason)}</td>
        <td>${escapeHtml(row.eventQuote)}</td>
      </tr>
    `)
    .join("");
}

export function buildReviewerBenchmarkHtml(report: ReviewerBenchmarkReport): string {
  const { summary } = report;
  const reviewerRows = [...report.reviewerRows].sort((a, b) => a.articleNumber - b.articleNumber);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reviewer Benchmark Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f2ea;
      --panel: #ffffff;
      --panel-2: #fbfaf7;
      --text: #1f1c17;
      --muted: #6c6258;
      --border: #ded4c6;
      --accent: #8b5e34;
      --accent-2: #3c6e71;
      --danger: #b5444c;
      --good: #2f7d32;
      --shadow: 0 12px 32px rgba(43, 32, 19, 0.08);
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top right, rgba(139, 94, 52, 0.08), transparent 28%),
        linear-gradient(180deg, #fbf7f1 0%, #f6f2ea 100%);
      color: var(--text);
    }
    .page {
      max-width: 1440px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }
    .hero {
      background: linear-gradient(135deg, #1f1c17 0%, #3c2f24 100%);
      color: #fff;
      border-radius: 24px;
      padding: 28px 30px;
      box-shadow: var(--shadow);
      margin-bottom: 24px;
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: 30px;
      letter-spacing: 0.2px;
    }
    .hero p {
      margin: 0;
      color: rgba(255, 255, 255, 0.84);
      line-height: 1.6;
      max-width: 920px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .metric-card, .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
    }
    .metric-card {
      padding: 18px 18px 16px;
      min-height: 104px;
    }
    .metric-label {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 10px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }
    .metric-subtitle {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .panels {
      display: grid;
      gap: 18px;
    }
    .panel {
      padding: 18px;
      overflow: hidden;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 20px;
    }
    .panel .subtitle {
      margin: -6px 0 16px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: var(--panel-2);
      border-radius: 14px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      text-align: right;
    }
    th {
      background: #f1ebe2;
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    tbody tr:nth-child(even) td {
      background: rgba(255, 255, 255, 0.55);
    }
    .empty-state {
      color: var(--muted);
      text-align: center;
      font-style: italic;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(60, 110, 113, 0.1);
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 600;
      margin: 6px 8px 0 0;
    }
    .section-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .small-note {
      color: var(--muted);
      font-size: 12px;
      margin-top: 8px;
      line-height: 1.5;
    }
    @media (max-width: 1200px) {
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .page { padding: 18px 12px 32px; }
      .summary-grid { grid-template-columns: 1fr; }
      .hero h1 { font-size: 24px; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>Reviewer Benchmark Dashboard</h1>
      <p>
        V5 reviewer quality summary for a single chunk. The dashboard measures the reviewer event pipeline end to end:
        structured events received, findings emitted, verifier outcomes, and the accuracy of ownership, snippets, and explanations.
      </p>
      <div class="section-toolbar">
        <span class="pill">Benchmark ${escapeHtml(report.benchmarkVersion)}</span>
        <span class="pill">Events ${formatInteger(report.eventCount)}</span>
        <span class="pill">Reviewers ${formatInteger(summary.totalReviewers)}</span>
        <span class="pill">Verifier accepted ${formatInteger(summary.totalVerifierAccepted)}</span>
        <span class="pill">Verifier rejected ${formatInteger(summary.totalVerifierRejected)}</span>
      </div>
    </section>

    <section class="summary-grid">
      ${renderMetricCard("Average precision", formatPercent(summary.averagePrecision), "Accepted findings / emitted findings")}
      ${renderMetricCard("Average recall", formatPercent(summary.averageRecall), "Owned events / received events")}
      ${renderMetricCard("Ownership accuracy", formatPercent(summary.averageOwnershipAccuracy), "Claimed article matches event owner")}
      ${renderMetricCard("Snippet accuracy", formatPercent(summary.averageSnippetAccuracy), "Evidence quote is locally supported")}
      ${renderMetricCard("Explanation accuracy", formatPercent(summary.averageExplanationAccuracy), "Rationale is event-grounded")}
      ${renderMetricCard("Average confidence", formatPercent(summary.averageConfidence), "Confidence across reviewer decisions")}
    </section>

    <section class="panels">
      <div class="panel">
        <h2>Reviewer Improvement Ranking</h2>
        <p class="subtitle">Reviewers are sorted from weakest to strongest so benchmark work can focus on the largest ownership gaps first.</p>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Article</th>
              <th>Title</th>
              <th>Pass</th>
              <th>Ownership</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>Avg Confidence</th>
            </tr>
          </thead>
          <tbody>${renderReviewerRankingRows(report.reviewerRanking)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Reviewer Rows</h2>
        <p class="subtitle">Per reviewer, one row per V5 article pass. Precision and recall are computed against the structured event layer.</p>
        <table>
          <thead>
            <tr>
              <th>Article</th>
              <th>Title</th>
              <th>Pass</th>
              <th>Received</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Ignored</th>
              <th>Emitted</th>
              <th>Verifier OK</th>
              <th>Verifier Drop</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>Ownership</th>
              <th>Snippet</th>
              <th>Explanation</th>
              <th>Avg Confidence</th>
            </tr>
          </thead>
          <tbody>${renderReviewerRows(reviewerRows)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Accepted Events</h2>
        <p class="subtitle">Each accepted event records the reviewer article, the expected owner, and the ownership-only decision reason.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Reviewer</th>
              <th>Expected</th>
              <th>Claim</th>
              <th>Event Quote</th>
              <th>Decision Reason</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>${renderDecisionRows(report.decisionAudits, true)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Rejected Events</h2>
        <p class="subtitle">Each rejected event records why the reviewer pass did not survive, using ownership-only diagnostics.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Reviewer</th>
              <th>Expected</th>
              <th>Claim</th>
              <th>Event Quote</th>
              <th>Reason for Rejection</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>${renderDecisionRows(report.decisionAudits, false)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>False Positives</h2>
        <p class="subtitle">Findings claimed by a reviewer but owned by a different article.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Reviewer</th>
              <th>Pass</th>
              <th>Claim</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Event Quote</th>
              <th>Evidence</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>${renderFalsePositiveRows(report.falsePositives)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>False Negatives</h2>
        <p class="subtitle">Owned events that did not survive reviewer output.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Owner</th>
              <th>Reason</th>
              <th>Event Quote</th>
            </tr>
          </thead>
          <tbody>${renderFalseNegativeRows(report.falseNegatives)}</tbody>
        </table>
      </div>
    </section>

    <div class="small-note">
      Dashboard data is generated deterministically from the same structured events and reviewer outputs used by the worker.
      No additional OpenAI calls are required.
    </div>
  </main>
</body>
</html>`;
}
