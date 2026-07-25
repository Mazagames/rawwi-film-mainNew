/**
 * Verifier stabilization checks for local evidence and ownership drift.
 * Run: npx tsx src/verifierStabilization.test.ts
 */
import {
  getPassSpecificEvidenceIssue,
  hasCanonicalAtomArticleMismatch,
  hasDriftProneArticleAnchor,
  hasPolicyArticleAnchor,
  hasRationaleLocalSupport,
} from "./verifierStabilization.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testSupportedRationalePasses() {
  assert(hasRationaleLocalSupport("يوجد وثيقة سرية", "فهد يجلس مع صديقه. شاشة تعرض وثيقة سرية."), "secret-document rationale should be locally supported");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 21,
      evidence_snippet: "فهد يجلس مع صديقه. شاشة تعرض وثيقة سرية.",
      rationale_ar: "يوجد وثيقة سرية",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "فهد يجلس مع صديقه. شاشة تعرض وثيقة سرية.",
    "فهد يجلس مع صديقه. شاشة تعرض وثيقة سرية.",
    [],
  );
  assert(issue == null, `expected supported secret-document rationale to pass, got ${issue}`);
  console.log("✓ Supported rationale is accepted");
}

function testUnsupportedRationaleRejected() {
  assert(!hasRationaleLocalSupport("يضر الاقتصاد", "مها... وينك؟"), "economic rationale should not be locally supported");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 19,
      evidence_snippet: "مها... وينك؟",
      rationale_ar: "يضر الاقتصاد",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "مها... وينك؟",
    "مها... وينك؟",
    [],
  );
  assert(issue === "unsupported_rationale", `expected unsupported_rationale, got ${issue}`);
  console.log("✓ Unsupported rationale is rejected");
}

function testOwnershipDriftRejected() {
  assert(!hasDriftProneArticleAnchor(15, "الجماعات المحظورة"), "public-order drift anchor should be required for article 15");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 15,
      evidence_snippet: "الجماعات المحظورة",
      rationale_ar: "الجماعات المحظورة",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "الجماعات المحظورة",
    "الجماعات المحظورة",
    [],
  );
  assert(issue === "ownership_drift", `expected ownership_drift, got ${issue}`);
  console.log("✓ Ownership drift is rejected");
}

function testArticleTopicAnchorRejected() {
  assert(!hasPolicyArticleAnchor(20, "مها... وينك؟"), "article 20 should require a business/financial anchor");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 20,
      evidence_snippet: "مها... وينك؟",
      rationale_ar: "وينك",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "مها... وينك؟",
    "مها... وينك؟",
    [],
  );
  assert(issue === "article_topic_mismatch", `expected article_topic_mismatch, got ${issue}`);
  console.log("✓ Article-topic mismatch is rejected");
}

function testCanonicalMismatchRejected() {
  assert(hasCanonicalAtomArticleMismatch(21, "PUBLIC_ORDER", null), "PUBLIC_ORDER should not map cleanly to article 21");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 21,
      evidence_snippet: "ملف مسرب",
      rationale_ar: "يوجد ملف مسرب",
      canonical_atom: "PUBLIC_ORDER",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "ملف مسرب",
    "ملف مسرب",
    [],
  );
  assert(issue === "canonical_article_mismatch", `expected canonical_article_mismatch, got ${issue}`);
  console.log("✓ Canonical/article mismatch is rejected");
}

function testAnchorHelperStillTrueForRelevantText() {
  assert(hasDriftProneArticleAnchor(12, "الطفل يتعرض للضرب"), "article 12 anchor should accept explicit child harm context");
  assert(hasPolicyArticleAnchor(21, "فهد يجلس مع صديقه. شاشة تعرض ملف مسرب."), "article 21 should accept secret-file context");
  console.log("✓ Article anchor helper accepts relevant text");
}

async function main() {
  testSupportedRationalePasses();
  testUnsupportedRationaleRejected();
  testOwnershipDriftRejected();
  testArticleTopicAnchorRejected();
  testCanonicalMismatchRejected();
  testAnchorHelperStillTrueForRelevantText();
  console.log("\nVerifier stabilization tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
