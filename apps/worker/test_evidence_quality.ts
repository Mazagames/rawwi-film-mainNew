import { getEvidenceQualityIssue, getStoredEvidenceQualityIssue } from "./src/pipeline.js";
import { groundFindingEvidenceToChunk } from "./src/pipeline.js";
import { config } from "./src/config.js";

async function main() {
  console.log("--------------------------------------------------");
  console.log("V5 EVIDENCE QUALITY VALIDATOR REGRESSION TEST");
  console.log("--------------------------------------------------");

  const chunkText = `بعض النص العشوائي...
نعم. نستخدم حسابات وهمية، نكتب إشاعات… ونركّب قصص عن “فساد” و“تستر” و“أوامر سرية”… حتى لو ما عندنا دليل.
الكذب يمشي. الناس تصدق اللي يخوفها. وإذا ما صدقوا… نخوفهم أكثر.
نص عشوائي آخر...`;

  const example1EventQuote = "نعم. نستخدم حسابات وهمية، نكتب إشاعات… ونركّب قصص عن “فساد” و“تستر” و“أوامر سرية”… حتى لو ما عندنا دليل.";
  const example1Evidence = "نستخدم حسابات وهمية، نكتب إشاعات… ونركّب قصص عن “فساد” و“تستر” و“أوامر سرية”… حتى لو ما عندنا دليل.";

  const example2EventQuote = "الكذب يمشي. الناس تصدق اللي يخوفها. وإذا ما صدقوا… نخوفهم أكثر.";
  const example2Evidence = "الكذب يمشي. الناس تصدق اللي يخوفها. وإذا ما صدقوا… نخوفهم أكثر.";

  const hallucinatedEvidence = "هذا نص غير موجود أبدا في النص الحقيقي.";

  const findingsToTest = [
    {
      id: "Example 1",
      eventQuote: example1EventQuote,
      evidenceSnippet: example1Evidence,
      event_id: 1,
    },
    {
      id: "Example 2",
      eventQuote: example2EventQuote,
      evidenceSnippet: example2Evidence,
      event_id: 2,
    },
    {
      id: "Hallucinated",
      eventQuote: example2EventQuote,
      evidenceSnippet: hallucinatedEvidence,
      event_id: 3,
    }
  ];

  for (const test of findingsToTest) {
    console.log(`\nTesting: ${test.id}`);
    console.log(`Event Quote: "${test.eventQuote}"`);
    console.log(`Evidence: "${test.evidenceSnippet}"`);

    const isSubstring = test.eventQuote.includes(test.evidenceSnippet);
    console.log(`Is exact substring of event quote: ${isSubstring}`);

    // Create finding object
    const finding: any = {
      article_id: 1,
      event_id: test.event_id,
      evidence_snippet: test.evidenceSnippet,
    };

    // Grounding
    const grounded = groundFindingEvidenceToChunk(finding, chunkText, 0, chunkText.length);
    if (!grounded) {
      console.log(`Grounding Result: DROPPED (Not contiguous / found in chunk)`);
    } else {
      console.log(`Grounding Result: SUCCESS`);
      console.log(`Reconstructed Start: ${grounded.start_offset_global}, End: ${grounded.end_offset_global}`);
      
      const qualityIssue = getEvidenceQualityIssue(grounded, chunkText);
      console.log(`getEvidenceQualityIssue: ${qualityIssue || 'None'}`);

      const storedIssue = getStoredEvidenceQualityIssue(
        grounded.evidence_snippet,
        chunkText,
        grounded.start_offset_global,
        grounded.end_offset_global
      );
      console.log(`getStoredEvidenceQualityIssue: ${storedIssue || 'None'}`);

      // Emulate pipeline logic
      const isV5EventFirst = config.VIOLATION_SYSTEM_VERSION === "v5" && finding.event_id != null;
      
      // We check our updated condition logic for getStoredEvidenceQualityIssue
      // pipeline.ts: if (objectiveEvidenceIssues.has(finalEvidenceIssue) && !isValidatorAdvisoryIssue(finalEvidenceIssue) && !isV5EventFirst)
      const objectiveEvidenceIssues = new Set([
        "evidence_mismatch",
        "evidence_not_found",
        "evidence_length_too_short",
      ]);
      const isValidatorAdvisoryIssue = (issue: string) => ["evidence_too_short", "evidence_length_too_short"].includes(issue);

      const isObjectiveCorruption = storedIssue && objectiveEvidenceIssues.has(storedIssue) && !isValidatorAdvisoryIssue(storedIssue);

      if (isObjectiveCorruption) {
        if (!isV5EventFirst) {
          console.log(`Final Decision: REJECTED (Legacy rules)`);
        } else {
          console.log(`Final Decision: KEPT (Advisory only for V5 event-first)`);
        }
      } else {
        console.log(`Final Decision: KEPT`);
      }
    }
  }
}

main().catch(console.error);
