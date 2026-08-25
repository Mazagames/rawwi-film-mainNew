import assert from "node:assert/strict";
import { enforceDeterministicOwnership } from "./deterministicOwnership.js";
import type { JudgeFinding } from "./schemas.js";
import type { StructuredEvent } from "./eventUnderstanding.js";

function buildFinding(articleId: number, evidenceSnippet: string, eventId = 1, startOffset = 0, endOffset = 0): JudgeFinding {
  return {
    article_id: articleId,
    event_id: eventId,
    atom_id: `${articleId}-1`,
    canonical_atom: `${articleId}-1`,
    title_ar: `Candidate ${articleId}`,
    description_ar: "candidate",
    severity: "medium",
    confidence: 0.9,
    evidence_snippet: evidenceSnippet,
    location: { start_offset: startOffset || 0, end_offset: endOffset || evidenceSnippet.length + 5, start_line: 0, end_line: 0 },
    rationale_ar: "candidate",
  } as JudgeFinding;
}

function testArticleOwnershipGateRejectsFalsePositiveArticle18And19(): void {
  const events: StructuredEvent[] = [
    {
      event_id: 1,
      quote: "أخبار سياسية عن مزاعم كاذبة ضد الحكومة المحلية، مع ذكر الاقتصاد في نفس المشهد لكن دون ضرر مالي أو سلوك دولي واضح.",
      event_summary: "political misinformation",
      actor: "unknown",
      action: "mentioned",
      target: "unknown",
      intent: "discuss",
      consequence: "none",
      dominant_meaning: "political misinformation",
      start_offset: 100,
      end_offset: 220,
    } as StructuredEvent,
  ];

  const findings = [
    buildFinding(18, "ذكر العراق والسفارة في المشهد السياسي"),
    buildFinding(19, "تم ذكر الاقتصاد في سياق سياسي دون ضرر مالي أو تضليل"),
    buildFinding(16, "انشروا معلومات مضللة ضد الحكومة المحلية"),
  ];

  const result = enforceDeterministicOwnership(findings, events, "");
  const survivingArticleIds = result.finalFindings.map((finding) => finding.article_id).sort((a, b) => a - b);

  assert.deepEqual(survivingArticleIds, [16], `expected only article 16 to survive, got ${survivingArticleIds.join(",")}`);
  console.log("✓ article ownership gate rejects weak article 18/19 candidates while retaining article 16");
}

function testArticleOwnershipGateKeepsExplicitInternationalAndConfidentialConduct(): void {
  const events: StructuredEvent[] = [
    {
      event_id: 2,
      quote: "انشروا أكاذيب ضد السفارة العراقية لقطع العلاقات الدبلوماسية، ثم نشروا ملفاً سرياً محمياً على الإنترنت.",
      event_summary: "international misinformation and confidential leak",
      actor: "unknown",
      action: "spread",
      target: "unknown",
      intent: "cause harm",
      consequence: "international tension",
      dominant_meaning: "harm",
      start_offset: 300,
      end_offset: 420,
    } as StructuredEvent,
  ];

  const findings = [
    buildFinding(18, "انشروا أكاذيب ضد السفارة العراقية لقطع العلاقات الدبلوماسية", 2, 300, 380),
    buildFinding(21, "نشروا ملفاً سرياً محمياً على الإنترنت", 2, 300, 380),
  ];

  const result = enforceDeterministicOwnership(findings, events, "");
  const survivingArticleIds = result.finalFindings.map((finding) => finding.article_id).sort((a, b) => a - b);

  assert.deepEqual(survivingArticleIds, [18, 21], `expected articles 18 and 21 to survive, got ${survivingArticleIds.join(",")}`);
  console.log("✓ article ownership gate preserves explicit international and confidential conduct");
}

function testArticleOwnershipGateKeepsExplicitCommercialConduct(): void {
  const events: StructuredEvent[] = [
    {
      event_id: 3,
      quote: "انشروا شائعة تجارية مضللة عن شركة كبيرة بهدف تدمير ثقة المستثمرين وسحب الأموال من السوق.",
      event_summary: "commercial misinformation",
      actor: "unknown",
      action: "spread",
      target: "unknown",
      intent: "cause harm",
      consequence: "financial panic",
      dominant_meaning: "commercial harm",
      start_offset: 500,
      end_offset: 620,
    } as StructuredEvent,
  ];

  const findings = [
    buildFinding(20, "انشروا شائعة تجارية مضللة عن شركة كبيرة بهدف تدمير ثقة المستثمرين", 3, 500, 580),
  ];

  const result = enforceDeterministicOwnership(findings, events, "");
  const survivingArticleIds = result.finalFindings.map((finding) => finding.article_id).sort((a, b) => a - b);

  assert.deepEqual(survivingArticleIds, [20], `expected article 20 to survive, got ${survivingArticleIds.join(",")}`);
  console.log("✓ article ownership gate preserves explicit commercial conduct");
}

function main(): void {
  testArticleOwnershipGateRejectsFalsePositiveArticle18And19();
  testArticleOwnershipGateKeepsExplicitInternationalAndConfidentialConduct();
  testArticleOwnershipGateKeepsExplicitCommercialConduct();
}

main();
