import type { JudgeFinding } from "./schemas.js";
import type { StructuredEvent } from "./eventUnderstanding.js";
import { findBestEventMatch, getEventConsistencyIssue } from "./eventConsistency.js";

const STRICT_ARTICLE_RULES: Record<number, { subject: RegExp; conduct: RegExp }> = {
  18: {
    subject: /(دولة|حكومة|شعب|أجنبية|سفارة|سفير|منظمة دولية|الأمم المتحدة|مجلس الأمن|دبلوماسي|علاقات دولية|دولية|أجنبية)/i,
    conduct: /(تحريض|تضليل|إضرار|تسبب|تدمير|قطع|علاقات دولية|علاقات خارجية|ردود فعل دولية|احتجاج|استفزاز|عدائي)/i,
  },
  19: {
    subject: /(بنك|سوق|عملة|استثمار|أزمة مالية|استقرار اقتصادي|اقتصادي|تمويل|مؤسسة مالية|اقتصاد)/i,
    conduct: /(تضليل مالي|ذعر مالي|سحب أموال|أزمة مالية|أضرار مالية|تأثير مالي|تخريب|إفلاس|تلاعب|انهيار|خسارة مالية|معلومات مالية مضللة)/i,
  },
  20: {
    subject: /(شركة|مؤسسة|تجاري|استثمار|سوق|تجارة|عمل|ثقة|إفلاس|مستثمر|اقتصادي)/i,
    conduct: /(مضللة|تجارية|استثمارية|ثقة تجارية|سمعة تجارية|إضرار|تسبب|إفلاس|تجاري|استثمار)/i,
  },
  21: {
    subject: /(سرية|مصنف|محمي|مقيد|غير علني|معلومات سرية|معلومات محمية|ملف سري|وثيقة سرية|معلومات مصنفة)/i,
    conduct: /(تسريب|اكتساب|وصول غير مصرح|إفشاء|نشر|توزيع|نقل|استخدام|استعمال|سرقة|اختراق|حصول بدون تصريح|إساءة استخدام)/i,
  },
};

function articleSpecificEvidenceScore(articleId: number, evidence: string, eventText: string): { pass: boolean; reason: string } {
  const rules = STRICT_ARTICLE_RULES[articleId];
  if (!rules) return { pass: true, reason: "no strict rule" };

  const localEvidence = `${evidence}\n${eventText}`.trim();
  const hasSubject = rules.subject.test(localEvidence);
  const hasConduct = rules.conduct.test(localEvidence);

  if (!hasSubject || !hasConduct) {
    return {
      pass: false,
      reason: `article ${articleId} requires an article-specific subject and conduct pair; evidence was too generic or topic-only`,
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
