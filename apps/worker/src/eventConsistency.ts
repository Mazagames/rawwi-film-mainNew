import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import type { JudgeFinding } from "./schemas.js";

export type EventConsistencyIssue =
  | "event_not_supported"
  | "event_evidence_mismatch"
  | "event_rationale_mismatch"
  | "event_span_mismatch"
  | "event_ambiguous";

export type EventConsistencyResult = {
  issue: EventConsistencyIssue | null;
  matchedEvent: StructuredEvent | null;
  matchedScore: number;
  runnerUpScore: number;
};

type EventFindingLike = Pick<
  JudgeFinding,
  "evidence_snippet" | "rationale_ar" | "title_ar" | "description_ar" | "location"
>;

const CONTENT_TOKEN_RE = /[\p{L}\p{N}]+/gu;
const STOPWORDS = new Set([
  "و",
  "في",
  "على",
  "إلى",
  "الى",
  "من",
  "عن",
  "أن",
  "إن",
  "كان",
  "كانت",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "ثم",
  "مع",
  "ما",
  "لا",
  "لم",
  "لن",
  "هو",
  "هي",
  "هم",
  "هن",
  "يا",
  "أو",
  "بل",
  "قد",
  "هناك",
  "هنا",
  "كل",
  "أي",
  "أيضاً",
  "ايضا",
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

function combineFindingText(finding: EventFindingLike): string {
  return [
    finding.evidence_snippet,
    finding.rationale_ar,
    finding.title_ar,
    finding.description_ar,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function scoreFindingAgainstEvent(finding: EventFindingLike, event: StructuredEvent): number {
  const findingText = normalizeText(combineFindingText(finding));
  const eventText = normalizeText(combineEventText(event));
  if (!findingText || !eventText) return 0;

  if (findingText === eventText) return 100;

  const snippet = normalizeText(String(finding.evidence_snippet ?? ""));
  const quote = normalizeText(event.quote);
  if (snippet && quote && (quote.includes(snippet) || snippet.includes(quote))) return 100;

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
    const overlapSpan = overlapLength(findingStart, findingEnd, event.start_offset, event.end_offset);
    if (overlapSpan > 0) {
      const minLen = Math.max(1, Math.min(findingEnd - findingStart, event.end_offset - event.start_offset));
      score += (overlapSpan / minLen) * 35;
    }
  }

  if (normalizeText(event.action) && findingText.includes(normalizeText(event.action))) score += 15;
  if (normalizeText(event.actor) && findingText.includes(normalizeText(event.actor))) score += 6;
  if (normalizeText(event.target) && findingText.includes(normalizeText(event.target))) score += 6;

  return score;
}

export function findBestEventMatch(
  finding: EventFindingLike,
  events: StructuredEvent[],
): { matchedEvent: StructuredEvent | null; matchedScore: number; runnerUpScore: number } {
  let matchedEvent: StructuredEvent | null = null;
  let matchedScore = 0;
  let runnerUpScore = 0;

  for (const event of events) {
    const score = scoreFindingAgainstEvent(finding, event);
    if (score > matchedScore) {
      runnerUpScore = matchedScore;
      matchedScore = score;
      matchedEvent = event;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  return { matchedEvent, matchedScore, runnerUpScore };
}

function isSnippetSupportedByEvent(finding: EventFindingLike, event: StructuredEvent): boolean {
  const snippet = normalizeText(String(finding.evidence_snippet ?? ""));
  const quote = normalizeText(event.quote);
  if (!snippet || !quote) return false;
  return quote.includes(snippet) || snippet.includes(quote);
}

function isRationaleSupportedByEvent(finding: EventFindingLike, event: StructuredEvent): boolean {
  const rationale = normalizeText(String(finding.rationale_ar ?? ""));
  if (!rationale) return true;
  const rationaleTokens = tokenize(rationale);
  if (rationaleTokens.length === 0) return true;

  const eventTokens = tokenSet(combineEventText(event));
  let overlap = 0;
  for (const token of rationaleTokens) {
    if (eventTokens.has(token)) overlap++;
  }
  if (overlap === 0) return false;
  return overlap / rationaleTokens.length >= 0.35;
}

function doesFindingSpanEvent(finding: EventFindingLike, event: StructuredEvent): boolean {
  const start = finding.location?.start_offset ?? null;
  const end = finding.location?.end_offset ?? null;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    typeof event.start_offset !== "number" ||
    typeof event.end_offset !== "number"
  ) {
    return true;
  }
  return overlapLength(start, end, event.start_offset, event.end_offset) > 0;
}

export function getEventConsistencyIssue(
  finding: EventFindingLike,
  events: StructuredEvent[],
): EventConsistencyResult {
  if (!events.length) {
    return {
      issue: null,
      matchedEvent: null,
      matchedScore: 0,
      runnerUpScore: 0,
    };
  }

  const match = findBestEventMatch(finding, events);
  if (!match.matchedEvent || match.matchedScore < 40) {
    return {
      issue: "event_not_supported",
      matchedEvent: match.matchedEvent,
      matchedScore: match.matchedScore,
      runnerUpScore: match.runnerUpScore,
    };
  }

  if (match.runnerUpScore >= 30 && match.matchedScore - match.runnerUpScore < 8) {
    return {
      issue: "event_ambiguous",
      matchedEvent: match.matchedEvent,
      matchedScore: match.matchedScore,
      runnerUpScore: match.runnerUpScore,
    };
  }

  if (!isSnippetSupportedByEvent(finding, match.matchedEvent)) {
    return {
      issue: "event_evidence_mismatch",
      matchedEvent: match.matchedEvent,
      matchedScore: match.matchedScore,
      runnerUpScore: match.runnerUpScore,
    };
  }

  if (!isRationaleSupportedByEvent(finding, match.matchedEvent)) {
    return {
      issue: "event_rationale_mismatch",
      matchedEvent: match.matchedEvent,
      matchedScore: match.matchedScore,
      runnerUpScore: match.runnerUpScore,
    };
  }

  if (!doesFindingSpanEvent(finding, match.matchedEvent)) {
    return {
      issue: "event_span_mismatch",
      matchedEvent: match.matchedEvent,
      matchedScore: match.matchedScore,
      runnerUpScore: match.runnerUpScore,
    };
  }

  return {
    issue: null,
    matchedEvent: match.matchedEvent,
    matchedScore: match.matchedScore,
    runnerUpScore: match.runnerUpScore,
  };
}
