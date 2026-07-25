/**
 * Tests for the reviewer benchmark framework.
 * Run: npx tsx src/reviewerBenchmark.test.ts
 */
import { buildReviewerBenchmarkHtml, buildReviewerBenchmarkReport } from "./reviewerBenchmark.js";
import type { EventUnderstandingPassResult } from "./eventUnderstanding.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function buildSyntheticEvents(): EventUnderstandingPassResult {
  return {
    chunk_start: 0,
    chunk_end: 180,
    event_count: 3,
    events: [
      {
        event_id: 1,
        actor: "سامي",
        target: "خالد",
        action: "يضرب",
        intent: "اعتداء جسدي",
        consequence: "يظهر الألم",
        quote: "يضرب سامي خالد بقوة",
        start_offset: 0,
        end_offset: 21,
        dominant_meaning: "اعتداء جسدي",
      },
      {
        event_id: 2,
        actor: "ليلى",
        target: "مازن",
        action: "تهدد",
        intent: "تهديد",
        consequence: "خوف",
        quote: "تهدد ليلى مازن بالقتل",
        start_offset: 40,
        end_offset: 61,
        dominant_meaning: "تهديد",
      },
      {
        event_id: 3,
        actor: "الشارع",
        target: "",
        action: "صراخ",
        intent: "انفعال درامي",
        consequence: "توتر",
        quote: "سمعت صوت صراخ في الشارع",
        start_offset: 90,
        end_offset: 114,
        dominant_meaning: "انفعال درامي",
      },
    ],
  };
}

function buildSyntheticUnderstanding(): EventUnderstandingPassResult {
  return buildSyntheticEvents();
}

function buildBenchmarkFixture() {
  const passResults = [
    {
      passName: "v5_article_07",
      findings: [
        {
          article_id: 7,
          detection_pass: "v5_article_07",
          confidence: 0.96,
          evidence_snippet: "يضرب سامي خالد بقوة",
          rationale_ar: "المقتطف يصف اعتداءً جسدياً مباشراً بين سامي وخالد.",
          title_ar: "اعتداء جسدي",
          description_ar: "ضرب مباشر",
          location: { start_offset: 0, end_offset: 21 },
        },
      ],
    },
    {
      passName: "v5_article_12",
      findings: [
        {
          article_id: 12,
          detection_pass: "v5_article_12",
          confidence: 0.91,
          evidence_snippet: "يضرب سامي خالد بقوة",
          rationale_ar: "هذا عنف ضد طفل.",
          title_ar: "عنف",
          description_ar: "إسناد خاطئ",
          location: { start_offset: 0, end_offset: 21 },
        },
        {
          article_id: 12,
          detection_pass: "v5_article_12",
          confidence: 0.87,
          evidence_snippet: "تهدد ليلى مازن بالقتل",
          rationale_ar: "هذا تهديد مباشر.",
          title_ar: "تهديد",
          description_ar: "تهديد صحيح",
          location: { start_offset: 40, end_offset: 61 },
        },
      ],
    },
    {
      passName: "v5_article_15",
      findings: [
        {
          article_id: 15,
          detection_pass: "v5_article_15",
          confidence: 0.72,
          evidence_snippet: "سمعت صوت صراخ في الشارع",
          rationale_ar: "تحريض على الفوضى.",
          title_ar: "فوضى",
          description_ar: "مغالطة ownership",
          location: { start_offset: 90, end_offset: 114 },
        },
      ],
    },
  ] as const;

  const finalFindings = [
    {
      article_id: 7,
      detection_pass: "v5_article_07",
      confidence: 0.96,
      evidence_snippet: "يضرب سامي خالد بقوة",
      rationale_ar: "المقتطف يصف اعتداءً جسدياً مباشراً بين سامي وخالد.",
      title_ar: "اعتداء جسدي",
      description_ar: "ضرب مباشر",
      location: { start_offset: 0, end_offset: 21 },
    },
    {
      article_id: 12,
      detection_pass: "v5_article_12",
      confidence: 0.87,
      evidence_snippet: "تهدد ليلى مازن بالقتل",
      rationale_ar: "هذا تهديد مباشر.",
      title_ar: "تهديد",
      description_ar: "تهديد صحيح",
      location: { start_offset: 40, end_offset: 61 },
    },
  ] as const;

  return { passResults, finalFindings };
}

function testReviewerBenchmarkReport(): void {
  const events = buildSyntheticUnderstanding();
  const { passResults, finalFindings } = buildBenchmarkFixture();
  const report = buildReviewerBenchmarkReport({
    chunkStart: 0,
    chunkEnd: 180,
    eventUnderstanding: events,
    passResults: passResults as any,
    finalFindings: finalFindings as any,
    reviewers: [
      { articleNumber: 7, articleTitle: "العنف", filename: "7.md", prompt: "", displayLabel: "المادة 07: العنف" },
      { articleNumber: 12, articleTitle: "الأمن الوطني", filename: "12.md", prompt: "", displayLabel: "المادة 12: الأمن الوطني" },
      { articleNumber: 15, articleTitle: "النظام العام", filename: "15.md", prompt: "", displayLabel: "المادة 15: النظام العام" },
    ],
  });

  const row7 = report.reviewerRows.find((row) => row.articleNumber === 7);
  const row12 = report.reviewerRows.find((row) => row.articleNumber === 12);
  const row15 = report.reviewerRows.find((row) => row.articleNumber === 15);

  assert(report.eventCount === 3, `expected 3 events, got ${report.eventCount}`);
  assert(row7?.eventsAccepted === 1, `expected article 7 to accept one event, got ${row7?.eventsAccepted ?? "missing"}`);
  assert(row12?.findingsEmitted === 2, `expected article 12 to emit two findings, got ${row12?.findingsEmitted ?? "missing"}`);
  assert(row12?.verifierAccepted === 1, `expected article 12 to have one verifier-accepted finding, got ${row12?.verifierAccepted ?? "missing"}`);
  assert(row12?.verifierRejected === 1, `expected article 12 to have one verifier-rejected finding, got ${row12?.verifierRejected ?? "missing"}`);
  assert(row12?.precision === 0.5, `expected article 12 precision 0.5, got ${row12?.precision ?? "missing"}`);
  assert(row12?.ownershipAccuracy === 1, `expected article 12 ownership accuracy 1, got ${row12?.ownershipAccuracy ?? "missing"}`);
  assert(report.decisionAudits.length === 9, `expected nine decision audits, got ${report.decisionAudits.length}`);
  assert(report.reviewerRanking.length === 3, `expected three ranking rows, got ${report.reviewerRanking.length}`);
  assert(report.summary.averageConfidence > 0, "expected average confidence to be populated");
  assert(report.falsePositives.some((issue) => issue.reviewerArticleId === 12 && issue.ownerArticleId === 7), "expected article 12 false positive against article 7");
  assert(report.falseNegatives.some((miss) => miss.ownerArticleId === 15 && miss.reason === "ownership rejected"), "expected article 15 false negative for ownership rejection");
  assert(row15?.eventsAccepted === 0, `expected article 15 to accept zero events, got ${row15?.eventsAccepted ?? "missing"}`);
  console.log("✓ reviewer benchmark report aggregates ownership and quality metrics");
}

function testReviewerBenchmarkHtml(): void {
  const events = buildSyntheticUnderstanding();
  const { passResults, finalFindings } = buildBenchmarkFixture();
  const report = buildReviewerBenchmarkReport({
    chunkStart: 0,
    chunkEnd: 180,
    eventUnderstanding: events,
    passResults: passResults as any,
    finalFindings: finalFindings as any,
    reviewers: [
      { articleNumber: 7, articleTitle: "العنف", filename: "7.md", prompt: "", displayLabel: "المادة 07: العنف" },
      { articleNumber: 12, articleTitle: "الأمن الوطني", filename: "12.md", prompt: "", displayLabel: "المادة 12: الأمن الوطني" },
      { articleNumber: 15, articleTitle: "النظام العام", filename: "15.md", prompt: "", displayLabel: "المادة 15: النظام العام" },
    ],
  });

  const html = buildReviewerBenchmarkHtml(report);
  assert(html.includes("Reviewer Benchmark Dashboard"), "dashboard should have a title");
  assert(html.includes("Reviewer Rows"), "dashboard should include reviewer rows table");
  assert(html.includes("Reviewer Improvement Ranking"), "dashboard should include reviewer ranking section");
  assert(html.includes("Accepted Events"), "dashboard should include accepted events section");
  assert(html.includes("Rejected Events"), "dashboard should include rejected events section");
  assert(html.includes("False Positives"), "dashboard should include false positive section");
  assert(html.includes("False Negatives"), "dashboard should include false negative section");
  assert(html.includes("12.0%") || html.includes("50.0%"), "dashboard should render percentages");
  console.log("✓ reviewer benchmark HTML dashboard renders");
}

async function main(): Promise<void> {
  testReviewerBenchmarkReport();
  testReviewerBenchmarkHtml();
  console.log("\nReviewer benchmark tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
