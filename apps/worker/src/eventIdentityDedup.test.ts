import assert from "node:assert/strict";
import { dedupeFindingsByEventIdentity, type EventIdentityFindingLike } from "./eventIdentityDedup.js";

function buildFinding(overrides: Partial<EventIdentityFindingLike>): EventIdentityFindingLike {
  return {
    article_id: 5,
    event_id: 1,
    evidence_snippet: "قام بالتهديد",
    severity: "medium",
    confidence: 0.8,
    ...overrides,
  };
}

function testSameEventSameArticleDifferentWordingIsCollapsed(): void {
  const findings = [
    buildFinding({ evidence_snippet: "قام بالتهديد", severity: "medium", confidence: 0.8 }),
    buildFinding({ evidence_snippet: "هدد الناس بالقتل", severity: "high", confidence: 0.95 }),
  ];

  const deduped = dedupeFindingsByEventIdentity(findings);
  assert.equal(deduped.length, 1, "same event + same article + overlapping evidence should collapse");
  assert.equal(deduped[0].severity, "high", "stronger duplicate should be kept");
  assert.equal(deduped[0].confidence, 0.95, "higher-confidence duplicate should be kept");
}

function testDifferentArticlesSameEventRemainSeparate(): void {
  const findings = [
    buildFinding({ article_id: 5, evidence_snippet: "تهديد مباشر" }),
    buildFinding({ article_id: 15, evidence_snippet: "تحريض على الشارع" }),
  ];

  const deduped = dedupeFindingsByEventIdentity(findings);
  assert.equal(deduped.length, 2, "same event + different valid articles should remain separate");
}

function testDifferentEventsSameArticleRemainSeparate(): void {
  const findings = [
    buildFinding({ event_id: 1, evidence_snippet: "تهديد مباشر" }),
    buildFinding({ event_id: 2, evidence_snippet: "تهديد مباشر في مشهد آخر" }),
  ];

  const deduped = dedupeFindingsByEventIdentity(findings);
  assert.equal(deduped.length, 2, "different events + same article should remain separate");
}

testSameEventSameArticleDifferentWordingIsCollapsed();
testDifferentArticlesSameEventRemainSeparate();
testDifferentEventsSameArticleRemainSeparate();
console.log("✓ event-identity dedup regression tests passed");
