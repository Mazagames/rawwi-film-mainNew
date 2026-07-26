import assert from "node:assert/strict";
import { parseJudgeWithRepair } from "./openai.js";

const raw = JSON.stringify({
  findings: [
    {
      article_id: 12,
      event_id: 7,
      canonical_atom: "PUBLIC_ORDER",
      intensity: 2,
      context_impact: 2,
      legal_sensitivity: 2,
      audience_risk: 2,
      title_ar: null,
      description_ar: "وصف تجريبي",
      rationale_ar: "رationale تجريبي",
      confidence: 0.9,
      evidence_snippet: "نص تجريبي",
      location: {
        start_offset: 10,
        end_offset: 20,
        start_line: 1,
        end_line: 1,
      },
    },
  ],
});

const result = await parseJudgeWithRepair(raw, "gpt-4.1");

assert.equal(result.findings.length, 0);
assert.equal(result.diagnostics.missing_title_count, 1);
assert.ok(result.diagnostics.parser_validation_errors.includes("Missing required field: title_ar"));

console.log("Missing title parser test passed.");
