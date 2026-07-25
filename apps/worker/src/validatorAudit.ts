import type { EventUnderstandingPassResult, StructuredEvent } from "./eventUnderstanding.js";
import { groundFindingEvidenceToChunk } from "./evidenceGrounding.js";
import { getEventConsistencyIssue } from "./eventConsistency.js";
import { hasDriftProneArticleAnchor, hasPoliticalAnchorForClassification, hasRationaleLocalSupport, hasSexualAnchorContext, hasViolenceKeywordEvidence, hasWomenSpecificEvidence } from "./verifierStabilization.js";
import { V3_SUBJECT_DEFINITIONS } from "./v3PromptPack.js";
import type { PassResult } from "./multiPassJudge.js";
import type { JudgeFinding } from "./schemas.js";

export type ValidatorAuditRecommendation = "keep" | "relax" | "remove";

export type ValidatorAuditRuleRow = {
  validationStage: string;
  functionName: string;
  rule: string;
  originalAssumption: string;
  category: "KEEP" | "MIGRATE";
  compatibleWithV5: boolean;
  recommendation: ValidatorAuditRecommendation;
  falseRejects: number;
};

export type ValidatorAuditRejectionRow = {
  validationStage: string;
  functionName: string;
  rule: string;
  reviewerArticleId: number;
  reviewerPassName: string;
  claimedArticleId: number | null;
  eventId: number | null;
  eventQuote: string;
  evidenceSnippet: string;
  rationaleAr: string | null;
  rejectionReason: string;
  isDemonstrablyCorrect: boolean;
};

export type ValidatorAuditReport = {
  auditVersion: "v1";
  chunkStart: number;
  chunkEnd: number;
  ruleRows: ValidatorAuditRuleRow[];
  rejectionRows: ValidatorAuditRejectionRow[];
  summary: {
    totalFindingsReviewed: number;
    totalRejectedFindings: number;
    totalFalseRejects: number;
    falseRejectRate: number;
    compatibleRuleCount: number;
    incompatibleRuleCount: number;
  };
};

type AuditFindingLike = Pick<
  JudgeFinding,
  | "article_id"
  | "atom_id"
  | "canonical_atom"
  | "confidence"
  | "detection_pass"
  | "evidence_snippet"
  | "location"
  | "rationale_ar"
  | "title_ar"
  | "description_ar"
>;

type FindingWithGlobalOffsets = AuditFindingLike & {
  start_offset_global: number;
  end_offset_global: number;
};

type ValidatorIssue = {
  functionName: string;
  validationStage: string;
  rule: string;
  rejectionReason: string;
  recommendation: ValidatorAuditRecommendation;
  compatibleWithV5: boolean;
  originalAssumption: string;
};

function getValidatorAuditCategory(recommendation: ValidatorAuditRecommendation): "KEEP" | "MIGRATE" {
  return recommendation === "keep" ? "KEEP" : "MIGRATE";
}

function makeRuleKey(functionName: string, validationStage: string, rule: string): string {
  return `${validationStage}|${functionName}|${rule}`;
}

type SceneIndexEntry = {
  sceneIndex: number;
  startOffset: number;
  endOffset: number;
};

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

const RULE_CATALOG: ValidatorIssue[] = [
  {
    functionName: "groundFindingEvidenceToChunk",
    validationStage: "Grounding",
    rule: "no_meaningful_exact_local_evidence",
    rejectionReason: "no_meaningful_exact_local_evidence",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Every accepted finding must be anchored to an exact local span in the source chunk.",
  },
  {
    functionName: "getEventConsistencyIssue",
    validationStage: "Event consistency",
    rule: "event_not_supported",
    rejectionReason: "event_not_supported",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Each accepted finding should correspond to one understandable narrative event.",
  },
  {
    functionName: "getEventConsistencyIssue",
    validationStage: "Event consistency",
    rule: "event_evidence_mismatch",
    rejectionReason: "event_evidence_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "The selected evidence must be supported by the structured event quote.",
  },
  {
    functionName: "getEventConsistencyIssue",
    validationStage: "Event consistency",
    rule: "event_rationale_mismatch",
    rejectionReason: "event_rationale_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "The rationale should describe the same event that the quote proves.",
  },
  {
    functionName: "getEventConsistencyIssue",
    validationStage: "Event consistency",
    rule: "event_span_mismatch",
    rejectionReason: "event_span_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "The finding offsets should land inside the same event span the reviewer claims.",
  },
  {
    functionName: "getEventConsistencyIssue",
    validationStage: "Event consistency",
    rule: "event_ambiguous",
    rejectionReason: "event_ambiguous",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "If two events are nearly equally plausible, the finding should not be forced through.",
  },
  {
    functionName: "getEvidenceQualityIssue",
    validationStage: "Evidence quality",
    rule: "empty",
    rejectionReason: "empty",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "A finding without evidence cannot be persisted or reported.",
  },
  {
    functionName: "getEvidenceQualityIssue",
    validationStage: "Evidence quality",
    rule: "non_text",
    rejectionReason: "non_text",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Evidence must contain readable script text, not only symbols or punctuation.",
  },
  {
    functionName: "getEvidenceQualityIssue",
    validationStage: "Evidence quality",
    rule: "too_short",
    rejectionReason: "too_short",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "The persisted excerpt must be long enough to be meaningful and auditable.",
  },
  {
    functionName: "getEvidenceQualityIssue",
    validationStage: "Evidence quality",
    rule: "evidence_mismatch",
    rejectionReason: "evidence_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Offsets and snippet text must agree exactly.",
  },
  {
    functionName: "getEvidenceQualityIssue",
    validationStage: "Evidence quality",
    rule: "missing_offsets",
    rejectionReason: "missing_offsets",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "A finding without offsets is hard to validate or surface in the UI.",
  },
  {
    functionName: "getStoredEvidenceQualityIssue",
    validationStage: "Stored evidence quality",
    rule: "heading_like",
    rejectionReason: "heading_like",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Headings and scene labels should not be treated as content evidence.",
  },
  {
    functionName: "getStoredEvidenceQualityIssue",
    validationStage: "Stored evidence quality",
    rule: "evidence_mismatch",
    rejectionReason: "evidence_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Persisted evidence must remain a literal slice of the source text.",
  },
  {
    functionName: "getStoredEvidenceQualityIssue",
    validationStage: "Stored evidence quality",
    rule: "missing_offsets",
    rejectionReason: "missing_offsets",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Stored findings should keep exact offsets for deterministic rendering.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "pass_article_mismatch",
    rejectionReason: "pass_article_mismatch",
    recommendation: "remove",
    compatibleWithV5: false,
    originalAssumption: "The old reviewer layout assumed a pass name could hard-route ownership to a subject article.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "unsupported_rationale",
    rejectionReason: "unsupported_rationale",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Rationale text should be lexically grounded in the local span, but this was tuned for older keyword-heavy reviewers.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "ownership_drift",
    rejectionReason: "ownership_drift",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Certain article families were fenced by anchor words to compensate for broad classifier-style reasoning.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "women_not_self_proving",
    rejectionReason: "women_not_self_proving",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Article ownership was being inferred from static women-related anchor words rather than event meaning.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "security_not_self_proving",
    rejectionReason: "security_not_self_proving",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Security findings were expected to expose governance anchors even when the event itself was already clear.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "political_not_self_proving",
    rejectionReason: "political_not_self_proving",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Political ownership was historically gated by explicit governance keywords.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "sexual_not_self_proving",
    rejectionReason: "sexual_not_self_proving",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Sexual content was being over-fenced by anchor terms instead of event interpretation.",
  },
  {
    functionName: "getPassSpecificEvidenceIssue",
    validationStage: "Pass-specific verifier",
    rule: "violence_single_word_non_violent",
    rejectionReason: "violence_single_word_non_violent",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Single-token violence claims were treated as weak unless they hit legacy keyword anchors.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "missing_political_anchor",
    rejectionReason: "missing_political_anchor",
    recommendation: "remove",
    compatibleWithV5: false,
    originalAssumption: "Political/security ownership could be forced through explicit governance keywords.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "school_context_not_governance",
    rejectionReason: "school_context_not_governance",
    recommendation: "remove",
    compatibleWithV5: false,
    originalAssumption: "School context was used as a keyword fence to block political/security classifications.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "school_system_word_not_governance",
    rejectionReason: "school_system_word_not_governance",
    recommendation: "remove",
    compatibleWithV5: false,
    originalAssumption: "The word النظام was treated as a keyword trap instead of a contextual signal.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "ungrounded_political_rationale",
    rejectionReason: "ungrounded_political_rationale",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Political language in the rationale had to repeat explicit governance keywords from the local window.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "missing_sexual_anchor",
    rejectionReason: "missing_sexual_anchor",
    recommendation: "remove",
    compatibleWithV5: false,
    originalAssumption: "Sexual content needed explicit anchor vocabulary regardless of event clarity.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "unsupported_rationale",
    rejectionReason: "unsupported_rationale",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "The rationale needed lexical overlap with the local window even when the event meaning was already supported.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "ownership_drift",
    rejectionReason: "ownership_drift",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Anchor words were used to prevent article drift in older classifier-style prompts.",
  },
  {
    functionName: "applyMemory2SanityGuards",
    validationStage: "Memory2 sanity guard",
    rule: "rationale_local_mismatch",
    rejectionReason: "rationale_local_mismatch",
    recommendation: "relax",
    compatibleWithV5: false,
    originalAssumption: "Rationale phrases were expected to repeat local wording rather than describe the selected event.",
  },
  {
    functionName: "canonicalization",
    validationStage: "Canonical/model alignment",
    rule: "canonical_model_mismatch",
    rejectionReason: "canonical_model_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "Persisted evidence should stay aligned with the model snippet after canonical normalization.",
  },
  {
    functionName: "scene_mismatch",
    validationStage: "Scene alignment",
    rule: "explicit_scene_mismatch",
    rejectionReason: "explicit_scene_mismatch",
    recommendation: "keep",
    compatibleWithV5: true,
    originalAssumption: "A finding should not be allowed to point at a scene whose text contradicts the rationale.",
  },
];

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function compactNormalizedEvidence(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
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

function combineFindingText(finding: Pick<JudgeFinding, "evidence_snippet" | "rationale_ar" | "title_ar" | "description_ar">): string {
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
  const match = /article_(\d{2})/i.exec(passName.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function scoreFindingAgainstEvent(finding: AuditFindingLike, event: StructuredEvent): number {
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

function bestEventMatch(finding: AuditFindingLike, events: StructuredEvent[]): { event: StructuredEvent | null; score: number } {
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

function isSnippetSupportedByEvent(finding: AuditFindingLike, event: StructuredEvent): boolean {
  const snippet = normalizeText(String(finding.evidence_snippet ?? ""));
  const quote = normalizeText(event.quote);
  if (!snippet || !quote) return false;
  return quote.includes(snippet) || snippet.includes(quote);
}

function isExplanationSupportedByEvent(finding: AuditFindingLike, event: StructuredEvent): boolean {
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

function buildSceneIndex(fullText: string | null): SceneIndexEntry[] {
  if (!fullText) return [];
  const matches = [...fullText.matchAll(/^(.*)$/gmu)];
  const headings = matches
    .map((match) => ({
      heading: (match[1] ?? "").replace(/\s+/g, " ").trim(),
      startOffset: match.index ?? 0,
    }))
    .filter((line) => {
      const heading = line.heading;
      if (!heading) return false;
      return (
        /^(?:المشهد|مشهد)\s*[\d\u0660-\u0669]+/u.test(heading) ||
        /^(?:[.٠-٩0-9]+\s+)?(?:المشهد|مشهد|الفصل|الطريق|منزل|سيارة)\b/u.test(heading) ||
        /^(?:داخلي|خارجي)\b/u.test(heading)
      );
    });

  return headings.map((heading, index) => ({
    sceneIndex: index + 1,
    startOffset: heading.startOffset,
    endOffset: headings[index + 1]?.startOffset ?? fullText.length,
  }));
}

function getEvidenceQualityIssue(finding: FindingWithGlobalOffsets, chunkText: string): string | null {
  const evidence = typeof finding.evidence_snippet === "string" ? finding.evidence_snippet : "";
  if (evidence.trim().length === 0) return "empty";
  if (!/[\p{L}]/u.test(evidence)) return "non_text";
  if (evidence.length < 2) return "too_short";

  const start = finding.location?.start_offset ?? null;
  const end = finding.location?.end_offset ?? null;
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end > start &&
    end <= chunkText.length
  ) {
    const span = chunkText.slice(start, end);
    if (span !== evidence) return "evidence_mismatch";
    return null;
  }

  return "missing_offsets";
}

function getSceneContextAtOffset(sceneIndex: SceneIndexEntry[], fullText: string | null, offset: number | null | undefined): string {
  if (!fullText || !sceneIndex.length || typeof offset !== "number" || offset < 0) return "";
  const scene = sceneIndex.find((entry) => offset >= entry.startOffset && offset < entry.endOffset);
  if (!scene) return "";
  return fullText.slice(scene.startOffset, scene.endOffset);
}

function extractQuotedPhrases(text: string): string[] {
  return [...text.matchAll(/["“”«»]([^"“”«»]{2,120})["“”«»]/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);
}

function hasOutOfWindowRationaleClaim(rationale: string, localWindow: string): boolean {
  const exactClaims = [
    "قلب نظام الحكم",
    "الانتفاض",
    "إسقاط الحكم",
    "أوامر سرية",
    "الإعلام الرسمي",
    "الوضع الاقتصادي",
    "مؤسسات الحكم",
    "التمرد ضد النظام",
    "تحريض الناس",
    "إشعال الفوضى",
    "زعزعة النظام العام",
  ];
  const exactDrift = exactClaims.some((claim) => rationale.includes(claim) && !localWindow.includes(claim));
  if (exactDrift) return true;

  const patternDrift = [
    /قلب\s+نظام|إسقاط\s+الحكم|الانتفاض|انتفاض|التمرد|تمرد/u,
    /الإعلام\s+الرسمي|مؤسسات\s+الحكم|أوامر\s+سرية|الوضع\s+الاقتصادي/u,
    /تحريض\s+الناس|إشعال\s+الفوضى|زعزعة\s+النظام/u,
  ].some((re) => re.test(rationale) && !re.test(localWindow));
  return patternDrift;
}

function hasUngroundedRationaleQuotes(rationale: string, localWindow: string): boolean {
  const quotes = extractQuotedPhrases(rationale);
  if (quotes.length === 0) return false;
  return quotes.some((quote) => !localWindow.includes(quote));
}

function hasPoliticalClaimLanguage(value: string): boolean {
  return /(?:قلب\s+نظام|إسقاط\s+الحكم|الانتفاض|تمرد|الإعلام\s+الرسمي|مؤسسات\s+الحكم|أوامر\s+سرية|الوضع\s+الاقتصادي|تحريض\s+الناس|إشعال\s+الفوضى|زعزعة\s+النظام)/u.test(
    value,
  );
}

function hasSchoolOrderContext(text: string): boolean {
  return /(?:مدرسة|فصل|معلم|معلمة|طلاب|طالب|طالبة|الدرس|الحصة|الواجب|الانضباط|الطابور|المدير|الإدارة التعليمية)/u.test(text);
}

function hasPoliticalGovernanceContext(text: string): boolean {
  return /(?:نظام\s+الحكم|القيادة\s+السياسية|الحكومة|الدولة|الملك|ولي\s+العهد|انقلاب|انتفاض|إسقاط|تمرد|قلب\s+نظام|مؤسسات\s+الحكم|الأمن\s+الوطني)/u.test(
    text,
  );
}

function isPoliticalOrSecurityFinding(finding: AuditFindingLike): boolean {
  const pass = String(finding.detection_pass ?? "").trim().toLowerCase();
  const atom = String(finding.canonical_atom ?? "").trim().toUpperCase();
  return (
    pass === "political_leadership" ||
    pass === "national_security" ||
    pass === "v3_02_political_leadership" ||
    pass === "v3_03_national_security" ||
    atom === "POLITICAL_LEADERSHIP" ||
    atom === "NATIONAL_SECURITY" ||
    finding.article_id === 2 ||
    finding.article_id === 3
  );
}

function isSexualFinding(finding: AuditFindingLike): boolean {
  const pass = String(finding.detection_pass ?? "").trim().toLowerCase();
  const atom = String(finding.canonical_atom ?? "").trim().toUpperCase();
  return (
    pass === "v3_10_explicit_sex" ||
    atom === "EXPLICIT_SEX" ||
    finding.article_id === 10 ||
    /(?:جنسي|عري|إيحاء\s+جنسي|فعل\s+فاضح|مشهد\s+حميمي)/u.test(String(finding.title_ar ?? "") + " " + String(finding.description_ar ?? "") + " " + String(finding.rationale_ar ?? ""))
  );
}

function getStoredEvidenceQualityIssue(
  evidenceSnippet: string | null | undefined,
  fullText: string | null,
  startOffsetGlobal: number | null | undefined,
  endOffsetGlobal: number | null | undefined,
): string | null {
  const evidence = typeof evidenceSnippet === "string" ? evidenceSnippet : "";
  if (evidence.trim().length === 0) return "empty";
  if (!/[\p{L}]/u.test(evidence)) return "non_text";
  if (evidence.length < 2) return "too_short";
  if (isHeadingLikeEvidence(evidence)) return "heading_like";

  if (
    typeof fullText === "string" &&
    typeof startOffsetGlobal === "number" &&
    typeof endOffsetGlobal === "number" &&
    startOffsetGlobal >= 0 &&
    endOffsetGlobal > startOffsetGlobal &&
    endOffsetGlobal <= fullText.length
  ) {
    const span = fullText.slice(startOffsetGlobal, endOffsetGlobal);
    if (span !== evidence) return "evidence_mismatch";
    return null;
  }

  return "missing_offsets";
}

function isHeadingLikeEvidence(value: string | null | undefined): boolean {
  const text = compactNormalizedEvidence(value);
  if (!text) return false;
  return (
    /^(?:المشهد|مشهد)\s*[\d\u0660-\u0669]+/u.test(text) ||
    (/^(?:داخلي|خارجي)\b/u.test(text) && text.length > 12) ||
    (/[\u0600-\u06FF]/u.test(text) && /(داخلي|خارجي)/u.test(text) && text.length > 24)
  );
}

function normalizeEvidenceCompareText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\s"'“”«»„:;,.!?()\[\]{}\-–—_]+/gu, " ")
    .trim()
    .toLowerCase();
}

function snippetsReasonablyAlign(modelSnippet: string, canonicalSnippet: string): boolean {
  const model = normalizeEvidenceCompareText(modelSnippet);
  const canonical = normalizeEvidenceCompareText(canonicalSnippet);
  if (!model || !canonical) return true;
  if (model === canonical) return true;
  if (model.includes(canonical) || canonical.includes(model)) return true;

  const modelTokens = model.split(/\s+/).filter((token) => token.length >= 2);
  const canonicalTokens = canonical.split(/\s+/).filter((token) => token.length >= 2);
  if (modelTokens.length === 0 || canonicalTokens.length === 0) return false;

  const canonicalSet = new Set(canonicalTokens);
  const overlap = modelTokens.filter((token) => canonicalSet.has(token)).length;
  const minTokenCount = Math.min(modelTokens.length, canonicalTokens.length);
  if (minTokenCount <= 2) return false;
  return overlap / minTokenCount >= 0.6;
}

function hasExplicitSceneMismatch(
  rationale: string | null,
  sceneIndex: SceneIndexEntry[],
  startOffsetGlobal: number | null,
  fullText: string | null,
): boolean {
  if (!rationale) return false;
  const sceneContext = getSceneContextAtOffset(sceneIndex, fullText, startOffsetGlobal);
  const exactClaims = [
    "قلب نظام الحكم",
    "الانتفاض",
    "إسقاط الحكم",
    "أوامر سرية",
    "الإعلام الرسمي",
    "الوضع الاقتصادي",
    "مؤسسات الحكم",
    "التمرد ضد النظام",
    "تحريض الناس",
    "إشعال الفوضى",
    "زعزعة النظام العام",
  ];
  const exactDrift = exactClaims.some((claim) => rationale.includes(claim) && !sceneContext.includes(claim));
  if (exactDrift) return true;

  const patternDrift = [
    /قلب\s+نظام|إسقاط\s+الحكم|الانتفاض|انتفاض|التمرد|تمرد/u,
    /الإعلام\s+الرسمي|مؤسسات\s+الحكم|أوامر\s+سرية|الوضع\s+الاقتصادي/u,
    /تحريض\s+الناس|إشعال\s+الفوضى|زعزعة\s+النظام/u,
  ].some((re) => re.test(rationale) && !re.test(sceneContext));
  return patternDrift;
}

function normalizeFindingKey(finding: {
  article_id?: number | null;
  detection_pass?: string | null;
  evidence_snippet?: string | null;
  start_offset_global?: number | null;
  end_offset_global?: number | null;
}): string {
  return [
    finding.article_id ?? "",
    String(finding.detection_pass ?? "").toLowerCase(),
    normalizeText(String(finding.evidence_snippet ?? "")),
    finding.start_offset_global ?? "",
    finding.end_offset_global ?? "",
  ].join("|");
}

function isAcceptedFinding(
  finding: FindingWithGlobalOffsets,
  finalFindings: Array<Pick<JudgeFinding, "article_id" | "detection_pass" | "evidence_snippet" | "location"> & {
    start_offset_global?: number | null;
    end_offset_global?: number | null;
  }>,
): boolean {
  const key = normalizeFindingKey(finding);
  return finalFindings.some((finalFinding) => {
    const finalKey = normalizeFindingKey({
      article_id: finalFinding.article_id ?? null,
      detection_pass: finalFinding.detection_pass ?? null,
      evidence_snippet: finalFinding.evidence_snippet ?? null,
      start_offset_global: finalFinding.start_offset_global ?? finalFinding.location?.start_offset ?? null,
      end_offset_global: finalFinding.end_offset_global ?? finalFinding.location?.end_offset ?? null,
    });
    return finalKey === key;
  });
}

function evaluateMemory2Guards(finding: FindingWithGlobalOffsets, chunkText: string): string | null {
  const localWindow = `${getSceneContextAtOffset(buildSceneIndex(chunkText), chunkText, finding.start_offset_global)}\n${chunkText}\n${finding.evidence_snippet ?? ""}`;
  const rationale = String(finding.rationale_ar ?? "");

  if (isPoliticalOrSecurityFinding(finding) && !hasPoliticalAnchorForClassification(localWindow)) {
    return "missing_political_anchor";
  }

  if (isPoliticalOrSecurityFinding(finding) && hasSchoolOrderContext(localWindow) && !hasPoliticalGovernanceContext(localWindow)) {
    return "school_context_not_governance";
  }

  if (isPoliticalOrSecurityFinding(finding) && /النظام/u.test(localWindow) && hasSchoolOrderContext(localWindow) && !hasPoliticalGovernanceContext(localWindow)) {
    return "school_system_word_not_governance";
  }

  if (hasPoliticalClaimLanguage(rationale) && !hasPoliticalAnchorForClassification(localWindow)) {
    return "ungrounded_political_rationale";
  }

  if (rationale && !hasRationaleLocalSupport(rationale, localWindow)) {
    return "unsupported_rationale";
  }

  if (isSexualFinding(finding) && !hasSexualAnchorContext(localWindow)) {
    return "missing_sexual_anchor";
  }

  if (finding.article_id != null && [12, 15, 19, 21, 23].includes(finding.article_id) && !hasDriftProneArticleAnchor(finding.article_id, localWindow)) {
    return "ownership_drift";
  }

  if (rationale && hasOutOfWindowRationaleClaim(rationale, localWindow)) {
    return "rationale_local_mismatch";
  }

  if (rationale && hasUngroundedRationaleQuotes(rationale, localWindow)) {
    return "rationale_local_mismatch";
  }

  return null;
}

function evaluatePassSpecificIssue(finding: FindingWithGlobalOffsets, chunkText: string, sceneIndex: SceneIndexEntry[]): string | null {
  const pass = String(finding.detection_pass ?? "").trim().toLowerCase();
  const atom = String(finding.canonical_atom ?? "").trim().toUpperCase();
  const articleId = finding.article_id ?? 0;
  const source = String((finding as { source?: string | null }).source ?? "ai").trim().toLowerCase();
  const rationale = String(finding.rationale_ar ?? "");
  if (source === "lexicon_mandatory" || source === "manual") return null;

  if (pass.startsWith("v3_")) {
    const subject = V3_SUBJECT_DEFINITIONS.find((item) => item.name.toLowerCase() === pass);
    if (subject && !subject.articleIds.includes(articleId)) {
      return "pass_article_mismatch";
    }
  }

  const sceneContext = getSceneContextAtOffset(sceneIndex, chunkText, finding.start_offset_global);
  const localContext = `${sceneContext}\n${finding.evidence_snippet ?? ""}`;

  if (rationale && !hasRationaleLocalSupport(rationale, localContext)) {
    return "unsupported_rationale";
  }

  if ([12, 15, 19, 21, 23].includes(articleId) && !hasDriftProneArticleAnchor(articleId, localContext)) {
    return "ownership_drift";
  }

  if ((pass === "women" || articleId === 7 || atom === "WOMEN") && !hasWomenSpecificEvidence(localContext)) {
    return "women_not_self_proving";
  }

  if (
    (pass === "v3_03_national_security" || pass === "national_security" || articleId === 3 || atom === "NATIONAL_SECURITY") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "security_not_self_proving";
  }

  if (
    (pass === "v3_02_political_leadership" || pass === "political_leadership" || articleId === 2 || atom === "POLITICAL_LEADERSHIP") &&
    !hasPoliticalAnchorForClassification(localContext)
  ) {
    return "political_not_self_proving";
  }

  if (
    (pass === "v3_10_explicit_sex" || articleId === 10 || atom === "EXPLICIT_SEX") &&
    !hasSexualAnchorContext(localContext)
  ) {
    return "sexual_not_self_proving";
  }

  const tokenCount = compactNormalizedEvidence(String(finding.evidence_snippet ?? "")).split(/\s+/).filter(Boolean).length;
  if ((pass === "violence" || articleId === 9 || atom === "VIOLENCE") && tokenCount === 1 && !hasViolenceKeywordEvidence(String(finding.evidence_snippet ?? ""))) {
    return "violence_single_word_non_violent";
  }

  return null;
}

function simulateValidatorPath(
  finding: FindingWithGlobalOffsets,
  chunkText: string,
  sceneIndex: SceneIndexEntry[],
  events: StructuredEvent[],
  memory2Enabled: boolean,
  useEventConsistencyChecks: boolean,
): { rejectionReason: string | null; functionName: string | null; validationStage: string | null; rule: string | null } {
  const grounded = groundFindingEvidenceToChunk(finding as JudgeFinding, chunkText);
  if (!grounded.grounded) {
    return {
      rejectionReason: grounded.reason ?? grounded.diagnostics?.rejection_reason ?? "no_meaningful_exact_local_evidence",
      functionName: "groundFindingEvidenceToChunk",
      validationStage: "Grounding",
      rule: "no_meaningful_exact_local_evidence",
    };
  }

  const groundedFinding: FindingWithGlobalOffsets = {
    ...(grounded.finding as AuditFindingLike),
    start_offset_global: finding.start_offset_global ?? grounded.finding.location?.start_offset ?? 0,
    end_offset_global: finding.end_offset_global ?? grounded.finding.location?.end_offset ?? 0,
  };

  const strictExactProofRequired = String(groundedFinding.detection_pass ?? "").trim().toLowerCase() !== "glossary";
  if (strictExactProofRequired && grounded.method !== "rationale_quote" && grounded.method !== "evidence_exact") {
    return {
      rejectionReason: "strict_exact_proof_required",
      functionName: "groundFindingEvidenceToChunk",
      validationStage: "Grounding",
      rule: "strict_exact_proof_required",
    };
  }

  const evidenceQualityIssue = getEvidenceQualityIssue(groundedFinding, chunkText);
  if (evidenceQualityIssue) {
    return {
      rejectionReason: evidenceQualityIssue,
      functionName: "getEvidenceQualityIssue",
      validationStage: "Evidence quality",
      rule: evidenceQualityIssue,
    };
  }

  const storedIssue = getStoredEvidenceQualityIssue(
    String(groundedFinding.evidence_snippet ?? ""),
    chunkText,
    groundedFinding.start_offset_global,
    groundedFinding.end_offset_global,
  );
  if (storedIssue) {
    return {
      rejectionReason: storedIssue,
      functionName: "getStoredEvidenceQualityIssue",
      validationStage: "Stored evidence quality",
      rule: storedIssue,
    };
  }

  if (useEventConsistencyChecks) {
    const eventConsistency = getEventConsistencyIssue(groundedFinding, events);
    if (eventConsistency.issue) {
      return {
        rejectionReason: eventConsistency.issue,
        functionName: "getEventConsistencyIssue",
        validationStage: "Event consistency",
        rule: eventConsistency.issue,
      };
    }
  } else {
    const passSpecificIssue = evaluatePassSpecificIssue(groundedFinding, chunkText, sceneIndex);
    if (passSpecificIssue) {
      return {
        rejectionReason: passSpecificIssue,
        functionName: "getPassSpecificEvidenceIssue",
        validationStage: "Pass-specific verifier",
        rule: passSpecificIssue,
      };
    }
  }

  if (memory2Enabled) {
    const memory2Issue = evaluateMemory2Guards(groundedFinding, chunkText);
    if (memory2Issue) {
      return {
        rejectionReason: memory2Issue,
        functionName: "applyMemory2SanityGuards",
        validationStage: "Memory2 sanity guard",
        rule: memory2Issue,
      };
    }
  }

  const canonicalSnippet = chunkText.slice(
    Math.max(0, groundedFinding.start_offset_global),
    Math.max(0, groundedFinding.end_offset_global),
  );
  if (!snippetsReasonablyAlign(String(groundedFinding.evidence_snippet ?? ""), canonicalSnippet)) {
    return {
      rejectionReason: "canonical_model_mismatch",
      functionName: "canonicalization",
      validationStage: "Canonical/model alignment",
      rule: "canonical_model_mismatch",
    };
  }

  if (hasExplicitSceneMismatch(String(groundedFinding.rationale_ar ?? null), sceneIndex, groundedFinding.start_offset_global, chunkText)) {
    return {
      rejectionReason: "explicit_scene_mismatch",
      functionName: "scene_mismatch",
      validationStage: "Scene alignment",
      rule: "explicit_scene_mismatch",
    };
  }

  return { rejectionReason: null, functionName: null, validationStage: null, rule: null };
}

export function buildValidatorAuditReport(args: {
  chunkStart: number;
  chunkEnd: number;
  chunkText: string;
  eventUnderstanding: EventUnderstandingPassResult | null;
  passResults: PassResult[];
  finalFindings: Array<Pick<JudgeFinding, "article_id" | "detection_pass" | "evidence_snippet" | "location"> & {
    start_offset_global?: number | null;
    end_offset_global?: number | null;
  }>;
  memory2Enabled: boolean;
  useEventConsistencyChecks: boolean;
}): ValidatorAuditReport {
  const sceneIndex = buildSceneIndex(args.chunkText);
  const events = args.eventUnderstanding?.events ?? [];
  const rejectionRows: ValidatorAuditRejectionRow[] = [];
  const falseRejectCounts = new Map<string, number>();
  let totalFindingsReviewed = 0;

  for (const passResult of args.passResults) {
    const reviewerArticleId = parsePassArticleNumber(passResult.passName);
    if (reviewerArticleId == null) continue;

    for (const finding of passResult.findings) {
      totalFindingsReviewed++;
      const claimedArticleId: number | null = finding.article_id ?? reviewerArticleId;
      const bestMatch = bestEventMatch(finding, events);
      const event = bestMatch.event;
      const groundedPreview = groundFindingEvidenceToChunk(finding, args.chunkText);
      const previewFinding: FindingWithGlobalOffsets = groundedPreview.grounded
        ? {
            ...(groundedPreview.finding as AuditFindingLike),
            start_offset_global:
              finding.location?.start_offset != null ? args.chunkStart + finding.location.start_offset : args.chunkStart + (groundedPreview.finding.location?.start_offset ?? 0),
            end_offset_global:
              finding.location?.end_offset != null ? args.chunkStart + finding.location.end_offset : args.chunkStart + (groundedPreview.finding.location?.end_offset ?? 0),
          }
        : {
            ...(finding as AuditFindingLike),
            start_offset_global: args.chunkStart + (finding.location?.start_offset ?? 0),
            end_offset_global: args.chunkStart + (finding.location?.end_offset ?? 0),
          };

      const accepted = isAcceptedFinding(previewFinding, args.finalFindings);
      if (accepted) {
        continue;
      }

      const rejection = simulateValidatorPath(
        previewFinding,
        args.chunkText,
        sceneIndex,
        events,
        args.memory2Enabled,
        args.useEventConsistencyChecks,
      );
      if (!rejection.rejectionReason) {
        continue;
      }

      const demonstrablyCorrect =
        Boolean(event) &&
        reviewerArticleId === claimedArticleId &&
        isSnippetSupportedByEvent(finding, event!) &&
        isExplanationSupportedByEvent(finding, event!);

      const row: ValidatorAuditRejectionRow = {
        validationStage: rejection.validationStage ?? "unknown",
        functionName: rejection.functionName ?? "unknown",
        rule: rejection.rule ?? rejection.rejectionReason,
        reviewerArticleId,
        reviewerPassName: passResult.passName,
        claimedArticleId,
        eventId: event?.event_id ?? null,
        eventQuote: event?.quote ?? "",
        evidenceSnippet: String(finding.evidence_snippet ?? ""),
        rationaleAr: finding.rationale_ar ?? null,
        rejectionReason: rejection.rejectionReason,
        isDemonstrablyCorrect: demonstrablyCorrect,
      };
      rejectionRows.push(row);

      if (demonstrablyCorrect) {
        const ruleKey = makeRuleKey(rejection.functionName ?? "unknown", rejection.validationStage ?? "unknown", rejection.rule ?? rejection.rejectionReason);
        const current = falseRejectCounts.get(ruleKey) ?? 0;
        falseRejectCounts.set(ruleKey, current + 1);
      }
    }
  }

  const ruleRows = RULE_CATALOG.map((rule) => ({
    ...rule,
    category: getValidatorAuditCategory(rule.recommendation),
    falseRejects: falseRejectCounts.get(makeRuleKey(rule.functionName, rule.validationStage, rule.rule)) ?? 0,
  }));

  const summary = {
    totalFindingsReviewed,
    totalRejectedFindings: rejectionRows.length,
    totalFalseRejects: [...falseRejectCounts.values()].reduce((sum, value) => sum + value, 0),
    falseRejectRate: totalFindingsReviewed > 0 ? [...falseRejectCounts.values()].reduce((sum, value) => sum + value, 0) / totalFindingsReviewed : 0,
    compatibleRuleCount: ruleRows.filter((row) => row.compatibleWithV5).length,
    incompatibleRuleCount: ruleRows.filter((row) => !row.compatibleWithV5).length,
  };

  return {
    auditVersion: "v1",
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
    ruleRows,
    rejectionRows,
    summary,
  };
}

export function toValidatorAuditLog(report: ValidatorAuditReport): Record<string, unknown> {
  return {
    auditVersion: report.auditVersion,
    chunkStart: report.chunkStart,
    chunkEnd: report.chunkEnd,
    summary: report.summary,
    ruleRows: report.ruleRows.map((row) => ({
      validationStage: row.validationStage,
      functionName: row.functionName,
      rule: row.rule,
      originalAssumption: row.originalAssumption,
      category: row.category,
      compatibleWithV5: row.compatibleWithV5,
      recommendation: row.recommendation,
      falseRejects: row.falseRejects,
    })),
    rejectionRows: report.rejectionRows.slice(0, 25),
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function renderRuleRows(rows: ValidatorAuditRuleRow[]): string {
  return rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.validationStage)}</td>
        <td>${escapeHtml(row.functionName)}</td>
        <td>${escapeHtml(row.rule)}</td>
        <td>${escapeHtml(row.originalAssumption)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.category === "KEEP" ? "Integrity check" : "Semantic migration")}</td>
        <td>${formatInteger(row.falseRejects)}</td>
      </tr>
    `)
    .join("");
}

function renderRejectionRows(rows: ValidatorAuditRejectionRow[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="8" class="empty-state">No rejected findings recorded.</td></tr>`;
  }

  return rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.validationStage)}</td>
        <td>${escapeHtml(row.functionName)}</td>
        <td>${escapeHtml(row.rule)}</td>
        <td>${escapeHtml(String(row.reviewerArticleId).padStart(2, "0"))}</td>
        <td>${escapeHtml(row.reviewerPassName)}</td>
        <td>${escapeHtml(String(row.eventId ?? "n/a"))}</td>
        <td>${escapeHtml(row.rejectionReason)}</td>
        <td>${escapeHtml(row.isDemonstrablyCorrect ? "yes" : "no")}</td>
      </tr>
    `)
    .join("");
}

export function buildValidatorAuditHtml(report: ValidatorAuditReport): string {
  const rows = [...report.ruleRows].sort((a, b) => {
    const stageDiff = a.validationStage.localeCompare(b.validationStage, "ar");
    if (stageDiff !== 0) return stageDiff;
    return a.rule.localeCompare(b.rule, "ar");
  });

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Validator Audit Dashboard</title>
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
      max-width: 1480px;
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
    }
    .hero p {
      margin: 0;
      color: rgba(255, 255, 255, 0.84);
      line-height: 1.6;
      max-width: 980px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
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
      <h1>Validator Audit Dashboard</h1>
      <p>
        This report replays the current validation pipeline deterministically and counts which rules still reject findings that
        are otherwise supported by the structured event layer.
      </p>
    </section>

    <section class="summary-grid">
      ${renderMetricCard("Rejected findings", formatInteger(report.summary.totalRejectedFindings), "Findings rejected by the current validator path")}
      ${renderMetricCard("False rejects", formatInteger(report.summary.totalFalseRejects), "Rejected findings that still look correct to the event layer")}
      ${renderMetricCard("KEEP rules", formatInteger(report.summary.compatibleRuleCount), "Integrity checks that remain safe to keep")}
      ${renderMetricCard("MIGRATE rules", formatInteger(report.summary.incompatibleRuleCount), "Semantic checks that should become advisory or be removed")}
    </section>

    <section class="panels">
      <div class="panel">
        <h2>Validator Rules</h2>
        <p class="subtitle">Every observed validator rule, its original assumption, its KEEP/MIGRATE classification, and how many demonstrably correct findings it rejected.</p>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Function</th>
              <th>Rule</th>
              <th>Original Assumption</th>
              <th>Category</th>
              <th>Interpretation</th>
              <th>False Rejects</th>
            </tr>
          </thead>
          <tbody>${renderRuleRows(rows)}</tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Rejected Findings</h2>
        <p class="subtitle">Rejected findings recorded during the replay, with the stage that rejected them first.</p>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Function</th>
              <th>Rule</th>
              <th>Reviewer</th>
              <th>Pass</th>
              <th>Event</th>
              <th>Reason</th>
              <th>Correct?</th>
            </tr>
          </thead>
          <tbody>${renderRejectionRows(report.rejectionRows)}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;
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
