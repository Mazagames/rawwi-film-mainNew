import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JudgeFinding } from "./schemas.js";
import type { StructuredEvent } from "./eventUnderstanding.js";
import { findBestEventMatch, getEventConsistencyIssue } from "./eventConsistency.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..", "..");
const reviewerRoot = join(repoRoot, "reviewers", "v5");

const STOPWORDS = new Set([
  "ال", "أن", "و", "في", "من", "على", "إلى", "عن", "لا", "هذا", "هذه", "ذلك", "لذا", "لكن", "أو", "ثم", "قد", "إذا", "كان",
  "يجب", "ما", "لم", "لن", "لن", "بأن", "بما", "كما", "أي", "كل", "بعض", "تلك", "الذي", "التي", "أحد", "أكثر", "أقل",
  "المادة", "المراجع", "الملاحظة", "المرشح", "الحدث", "الاقتباس", "القرار", "الهدف", "السبب", "النتيجة", "المنشأ", "اللغة",
  "بشكل", "عليه", "ليس", "يكون", "لأن", "حتى", "مع", "بعد", "قبل", "تكون", "غير", "ممكن", "متى", "فقط", "أثناء",
  "ذكر", "ذكروا", "تذكر", "مذكور", "تتضمن", "يتضمن", "تستوفي", "تخرج", "تعتبر", "تثبت", "تظهر", "يظهر", "تؤثر", "يؤثر",
  "تحتاج", "يحتاج", "الذي", "التي", "الذي", "التي", "تحدد", "يحدد", "تعمل", "يعمل", "تدل", "تدلل", "تدخل",
]);

const GENERIC_TERMS = new Set(["مادة", "ملاحظة", "مرشح", "حدث", "اقتباس", "قرار", "هدف", "سبب", "نتيجة", "منشأ", "لغة", "سياق", "مراجعة", "بناء", "تحليل", "محتوى", "مهم"]);

function normalizeArabicToken(token: string): string {
  return token
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .replace(/^ال/, "")
    .trim();
}

function extractArabicTokens(text: string): string[] {
  return Array.from(text.matchAll(/[\u0600-\u06FF]+/g), (match) => normalizeArabicToken(match[0]))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !GENERIC_TERMS.has(token));
}

function getMarkdownDefinition(articleId: number): string | null {
  if (!existsSync(reviewerRoot)) return null;

  const files = readdirSync(reviewerRoot)
    .filter((fileName) => /^article_\d{2}_/.test(fileName))
    .sort();

  const targetFile = files.find((fileName) => fileName.startsWith(`article_${String(articleId).padStart(2, "0")}_`));
  if (!targetFile) return null;

  const filePath = join(reviewerRoot, targetFile);
  if (!existsSync(filePath)) return null;

  return readFileSync(filePath, "utf8");
}

function normalizeForTermMatch(value: string): string {
  const normalized = normalizeArabicToken(value)
    .replace(/[ة]/g, "")
    .replace(/[ى]/g, "ي")
    .replace(/[ًًٌٍ]/g, "")
    .replace(/ا$/g, "")
    .replace(/وا$/g, "")
    .replace(/ين$/g, "")
    .trim();
  return normalized;
}

function tokenMatchesTerm(token: string, term: string): boolean {
  const normalizedToken = normalizeForTermMatch(token);
  const normalizedTerm = normalizeForTermMatch(term);
  if (!normalizedToken || !normalizedTerm) return false;
  return normalizedToken === normalizedTerm
    || normalizedToken.includes(normalizedTerm)
    || normalizedTerm.includes(normalizedToken)
    || normalizedToken.slice(0, 3) === normalizedTerm.slice(0, 3);
}

function hasNegativeCue(text: string): boolean {
  const normalized = normalizeArabicToken(text);
  return /(دون|بدون|بلا|من دون|ما لم|ليس|غير|عدم|لا ضرر|لا damage|لا ضرر مالي|لا سلوك|لا دليل|لا كذب|لا تضليل)/i.test(normalized);
}

function buildDefinitionTerms(articleId: number): { subjectTerms: string[]; conductTerms: string[] } {
  const markdown = getMarkdownDefinition(articleId);
  if (!markdown) return { subjectTerms: [], conductTerms: [] };

  const lines = markdown.split(/\r?\n/);
  const subjectLines: string[] = [];
  const conductLines: string[] = [];
  let currentSection: "subject" | "conduct" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,6})\s*(Decision Principle|Gate 1|Gate 2|Gate 3)/i);
    if (headingMatch) {
      if (/gate 1|decision principle/i.test(headingMatch[2])) {
        currentSection = "subject";
      } else if (/gate 2|gate 3/i.test(headingMatch[2])) {
        currentSection = "conduct";
      } else {
        currentSection = null;
      }
      continue;
    }

    if (!trimmed) continue;
    if (currentSection === "subject") {
      subjectLines.push(trimmed);
    } else if (currentSection === "conduct") {
      conductLines.push(trimmed);
    }
  }

  const collectTerms = (lines: string[]): string[] => {
    const counts = new Map<string, number>();

    for (const line of lines.slice(0, 6)) {
      for (const token of extractArabicTokens(line)) {
        const normalized = normalizeArabicToken(token);
        if (!normalized || normalized.length < 2 || STOPWORDS.has(normalized)) continue;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .filter(([, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([term]) => term);
  };

  return {
    subjectTerms: collectTerms(subjectLines),
    conductTerms: collectTerms(conductLines),
  };
}

function articleSpecificEvidenceScore(articleId: number, evidence: string, eventText: string): { pass: boolean; reason: string } {
  const localEvidence = (evidence || eventText).trim();
  if (!localEvidence) return { pass: true, reason: "no evidence to evaluate" };

  const { subjectTerms, conductTerms } = buildDefinitionTerms(articleId);
  if (!subjectTerms.length || !conductTerms.length) {
    return { pass: true, reason: "no reviewer definition available" };
  }

  const evidenceTokens = Array.from(new Set(extractArabicTokens(localEvidence)));
  const hasSubject = subjectTerms.some((term) => evidenceTokens.some((token) => tokenMatchesTerm(token, term)));
  const hasConduct = conductTerms.some((term) => evidenceTokens.some((token) => tokenMatchesTerm(token, term)));

  if (articleId === 14) {
    const explicitInsultSignal = /(فاشل|حمارة|غبي|أحمق|قذر|مقرف|خائن|متخلف|عديم التربية|سافل|دنيء|حقير|مخجل|مقزز|مذل|مجرم|وحش|غليظ|عبيط|شتيمة|إهانة|مهين|مسيئ|محتقر|مذل)/i;
    if (explicitInsultSignal.test(localEvidence)) {
      return { pass: true, reason: "explicit insult evidence present" };
    }
  }

  if (hasNegativeCue(localEvidence)) {
    return {
      pass: false,
      reason: `article ${articleId} requires explicit positive article-specific evidence; negated or weak wording does not satisfy the gate`,
    };
  }

  if (subjectTerms.length < 2 || conductTerms.length < 2) {
    return { pass: true, reason: "definition did not expose enough article-specific cues" };
  }

  if (!hasSubject || !hasConduct) {
    return {
      pass: false,
      reason: `article ${articleId} requires article-specific subject and conduct evidence from the reviewer definition`,
    };
  }

  return { pass: true, reason: "article-specific evidence present" };
}

export type OwnershipDiagnostic = {
  article_id?: number | null;
  canonical_atom?: string | null;
  reason: string;
  evidence_excerpt: string;
};

export type DeterministicOwnershipResult = {
  finalFindings: JudgeFinding[];
  diagnostics: {
    candidateCountBefore: number;
    droppedByOwnership: number;
    droppedByEventMismatch: number;
    finalCount: number;
    droppedFindings: OwnershipDiagnostic[];
  };
};

function normalizeSpan(finding: JudgeFinding): string {
  if (typeof finding.location?.start_offset === "number" && typeof finding.location?.end_offset === "number") {
    return `${finding.location.start_offset}-${finding.location.end_offset}`;
  }
  return String(finding.evidence_snippet ?? "").trim();
}

/**
 * Deterministic ownership resolver for V5 Judge candidates.
 * Enforces pairwise suppression rules for overlapping claims on the same underlying act.
 */
export function enforceDeterministicOwnership(
  findings: JudgeFinding[],
  events: StructuredEvent[],
  chunkText: string
): DeterministicOwnershipResult {
  const diagnostics: OwnershipDiagnostic[] = [];
  let droppedByOwnership = 0;
  let droppedByEventMismatch = 0;

  // Step 1: Assign findings to groups
  // Keyed by event_id or normalized span
  const groups = new Map<string, { finding: JudgeFinding; matchedEvent: StructuredEvent | null; issue: string | null }[]>();

  for (const finding of findings) {
    const matchResult = findBestEventMatch(finding as any, events);
    const matchedEvent = matchResult.matchedEvent;
    
    let issue: string | null = null;
    if (matchedEvent) {
      issue = getEventConsistencyIssue(finding as any, [matchedEvent]).issue;
    }

    const groupKey = matchedEvent ? `event_${matchedEvent.event_id}` : `span_${normalizeSpan(finding)}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push({ finding, matchedEvent, issue });
  }

  const finalFindings: JudgeFinding[] = [];

  // Step 2 & 3 & 4: Evaluate each group
  for (const [groupKey, group] of groups.entries()) {
    // Collect finding indices that are suppressed
    const suppressed = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        
        const f1 = group[i].finding;
        const f2 = group[j].finding;
        const a1 = f1.article_id;
        const a2 = f2.article_id;

        // CHILD_SAFETY (12) may suppress INSULT (14), MISINFORMATION (16), and PRIVACY (17) only for the same child-abuse act
        if (a1 === 12 && (a2 === 14 || a2 === 16 || a2 === 17)) {
          suppressed.add(j);
          diagnostics.push({
            article_id: a2,
            canonical_atom: f2.canonical_atom ?? null,
            reason: "Suppressed by CHILD_SAFETY (Article 12) for same child-abuse act",
            evidence_excerpt: String(f2.evidence_snippet).substring(0, 100),
          });
          continue;
        }

        // PRIVACY (17) may suppress INSULT (14) only for the same privacy/defamation/blackmail act
        if (a1 === 17 && a2 === 14) {
          suppressed.add(j);
          diagnostics.push({
            article_id: a2,
            canonical_atom: f2.canonical_atom ?? null,
            reason: "Suppressed by PRIVACY (Article 17) for same privacy act",
            evidence_excerpt: String(f2.evidence_snippet).substring(0, 100),
          });
          continue;
        }

        // PUBLIC_ORDER (15) may suppress MISINFORMATION (16) only when the same evidence is direct incitement
        if (a1 === 15 && a2 === 16) {
          suppressed.add(j);
          diagnostics.push({
            article_id: a2,
            canonical_atom: f2.canonical_atom ?? null,
            reason: "Suppressed by PUBLIC_ORDER (Article 15) for same incitement act",
            evidence_excerpt: String(f2.evidence_snippet).substring(0, 100),
          });
          continue;
        }

        // HATE_SPEECH (10) suppresses standalone INSULT (14) only when the same evidence is group/identity-based
        if (a1 === 10 && a2 === 14) {
          suppressed.add(j);
          diagnostics.push({
            article_id: a2,
            canonical_atom: f2.canonical_atom ?? null,
            reason: "Suppressed by HATE_SPEECH (Article 10) for same identity-based act",
            evidence_excerpt: String(f2.evidence_snippet).substring(0, 100),
          });
          continue;
        }
      }
    }

    droppedByOwnership += suppressed.size;

    for (let i = 0; i < group.length; i++) {
      if (suppressed.has(i)) continue;

      const item = group[i];
      const issue = item.issue;
      const matchedEventText = item.matchedEvent?.quote ?? "";
      const ownershipCheck = articleSpecificEvidenceScore(item.finding.article_id, String(item.finding.evidence_snippet ?? ""), matchedEventText);
      
      if (issue === "event_span_mismatch" || issue === "event_evidence_mismatch") {
        droppedByEventMismatch++;
        diagnostics.push({
          article_id: item.finding.article_id,
          canonical_atom: item.finding.canonical_atom ?? null,
          reason: `Rejected due to ${issue}`,
          evidence_excerpt: String(item.finding.evidence_snippet).substring(0, 100),
        });
        continue;
      }
      
      if (issue === "event_ambiguous") {
        diagnostics.push({
          article_id: item.finding.article_id,
          canonical_atom: item.finding.canonical_atom ?? null,
          reason: `Logged event_ambiguous (retained)`,
          evidence_excerpt: String(item.finding.evidence_snippet).substring(0, 100),
        });
      }

      if (!ownershipCheck.pass) {
        diagnostics.push({
          article_id: item.finding.article_id,
          canonical_atom: item.finding.canonical_atom ?? null,
          reason: ownershipCheck.reason,
          evidence_excerpt: String(item.finding.evidence_snippet).substring(0, 100),
        });
        continue;
      }
      
      finalFindings.push(item.finding);
    }
  }

  return {
    finalFindings,
    diagnostics: {
      candidateCountBefore: findings.length,
      droppedByOwnership,
      droppedByEventMismatch,
      finalCount: finalFindings.length,
      droppedFindings: diagnostics.filter(d => !d.reason.includes("retained")),
    },
  };
}
