import 'dotenv/config';
import { parseJudgeWithRepair } from './src/openai.js';

async function run() {
  console.log("=== REGRESSION TEST: V5 Article ID Propagation ===");
  
  const systemPrompt = "Test";
  const userPrompt = "Test";
  
  // Test 1: V5 Article 14 response WITHOUT article_id -> normalized to 14
  const withoutId = JSON.stringify({
    findings: [{
      event_id: 5,
      title_ar: "إهانة",
      rationale_ar: "قوم يا عديم التربية.",
      evidence_snippet: "قوم يا عديم التربية.",
      confidence: 1
    }]
  });
  
  let res = await parseJudgeWithRepair(withoutId, "gpt-4.1", { passName: "v5_article_14" });
  console.log("Without article_id:", res.findings[0]?.article_id === 14 ? "PASSED (normalized to 14)" : "FAILED");
  
  // Test 2: V5 Article 14 response WITH article_id 14 -> survives
  const withId14 = JSON.stringify({
    findings: [{
      article_id: 14,
      event_id: 5,
      title_ar: "إهانة",
      rationale_ar: "قوم يا عديم التربية.",
      evidence_snippet: "قوم يا عديم التربية.",
      confidence: 1
    }]
  });
  
  res = await parseJudgeWithRepair(withId14, "gpt-4.1", { passName: "v5_article_14" });
  console.log("With article_id 14:", res.findings[0]?.article_id === 14 ? "PASSED (survives as 14)" : "FAILED");
  
  // Test 3: V5 Article 14 response WITH article_id 12 -> rejected
  const withId12 = JSON.stringify({
    findings: [{
      article_id: 12,
      event_id: 5,
      title_ar: "إهانة",
      rationale_ar: "قوم يا عديم التربية.",
      evidence_snippet: "قوم يا عديم التربية.",
      confidence: 1
    }]
  });
  
  res = await parseJudgeWithRepair(withId12, "gpt-4.1", { passName: "v5_article_14" });
  console.log("With article_id 12:", res.findings.length === 0 ? "PASSED (rejected cross-article)" : "FAILED");
  
  // Test 4: Non-V5 behavior remains unchanged (article_id parsed from atom_id)
  const nonV5 = JSON.stringify({
    findings: [{
      atom_id: "14-2",
      title_ar: "إهانة",
      rationale_ar: "قوم يا عديم التربية.",
      evidence_snippet: "قوم يا عديم التربية.",
      confidence: 1
    }]
  });
  
  res = await parseJudgeWithRepair(nonV5, "gpt-4.1", { passName: "v3_14_parents_abuse" });
  console.log("Non-V5 behavior:", res.findings[0]?.article_id === 14 ? "PASSED (parsed from atom_id)" : "FAILED");
}

run().catch(console.error);
