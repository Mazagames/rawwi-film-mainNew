/**
 * Verifier stabilization checks for local evidence and ownership drift.
 * Run: npx tsx src/verifierStabilization.test.ts
 */
import {
  getPassSpecificEvidenceIssue,
  hasDriftProneArticleAnchor,
  hasRationaleLocalSupport,
} from "./verifierStabilization.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testSupportedRationalePasses() {
  assert(hasRationaleLocalSupport("هذا عنف ضد طفل", "الطفل يتعرض للضرب"), "child rationale should be locally supported");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 12,
      evidence_snippet: "الطفل يتعرض للضرب",
      rationale_ar: "هذا عنف ضد طفل",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "الطفل يتعرض للضرب",
    "الطفل يتعرض للضرب",
    [],
  );
  assert(issue == null, `expected supported child rationale to pass, got ${issue}`);
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
  assert(!hasDriftProneArticleAnchor(23, "المشهد جميل"), "appearance anchor should be required for article 23");
  const issue = getPassSpecificEvidenceIssue(
    {
      article_id: 23,
      evidence_snippet: "المشهد جميل",
      rationale_ar: "المشهد جميل",
      start_offset_global: 0,
      detection_pass: "v5",
    },
    "المشهد جميل",
    "المشهد جميل",
    [],
  );
  assert(issue === "ownership_drift", `expected ownership_drift, got ${issue}`);
  console.log("✓ Ownership drift is rejected");
}

function testAnchorHelperStillTrueForRelevantText() {
  assert(hasDriftProneArticleAnchor(12, "الطفل يتعرض للضرب"), "article 12 anchor should accept explicit child harm context");
  console.log("✓ Article anchor helper accepts relevant text");
}

async function main() {
  testSupportedRationalePasses();
  testUnsupportedRationaleRejected();
  testOwnershipDriftRejected();
  testAnchorHelperStillTrueForRelevantText();
  console.log("\nVerifier stabilization tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
