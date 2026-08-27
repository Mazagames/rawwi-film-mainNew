import { enforceDeterministicOwnership } from "./src/deterministicOwnership.js";
import { getEventConsistencyIssue } from "./src/eventConsistency.js";

async function runTest() {
  // Mock events from Event Understanding
  const events = [
    {
      event_id: 1,
      event_summary: "الأب فهد يعنف ابنه سامي لفظيا",
      actor: "فهد",
      target: "سامي",
      action: "يقول له يا عديم التربية",
      intent: "غضب وتأديب",
      consequence: "خوف الطفل",
      quote: "قوم يا عديم التربية",
      start_offset: 100,
      end_offset: 200,
      dominant_meaning: "عنف لفظي ضد طفل"
    },
    {
      event_id: 2,
      event_summary: "المعلم ناصر يمسك أذن سامي",
      actor: "ناصر",
      target: "سامي",
      action: "يمسك أذن سامي بقوة",
      intent: "تأديب",
      consequence: "ألم الطفل",
      quote: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب",
      start_offset: 500,
      end_offset: 600,
      dominant_meaning: "عنف جسدي ضد طفل في المدرسة"
    },
    {
      event_id: 3,
      event_summary: "فهد وحسام يخططان لحملة مضللة",
      actor: "فهد",
      target: "المجتمع",
      action: "تخطيط لحملة حسابات وهمية",
      intent: "نشر الفوضى",
      consequence: "خطر على النظام",
      quote: "نستخدم حسابات وهمية، نكتب إشاعات",
      start_offset: 800,
      end_offset: 900,
      dominant_meaning: "التخطيط لنشر شائعات وتحريض"
    }
  ];

  // Mock findings from runMultiPassDetection (already grounded)
  const findings = [
    // Case 1: School scene
    {
      article_id: 12,
      evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب",
      rationale_ar: "عنف ضد طفل",
      canonical_atom: "child_abuse",
      location: { start_offset: 500, end_offset: 600 }
    },
    {
      article_id: 16,
      evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب",
      rationale_ar: "معلومات مضللة", // This rationale makes no sense for the event
      canonical_atom: "misinfo",
      location: { start_offset: 500, end_offset: 600 }
    },
    {
      article_id: 17,
      evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب",
      rationale_ar: "انتهاك خصوصية", // This rationale makes no sense for the event
      canonical_atom: "privacy",
      location: { start_offset: 500, end_offset: 600 }
    },
    // Case 2: Child abuse (verbal) vs Insult
    {
      article_id: 12,
      evidence_snippet: "قوم يا عديم التربية",
      rationale_ar: "عنف لفظي ضد طفل",
      canonical_atom: "child_abuse_verbal",
      location: { start_offset: 100, end_offset: 200 }
    },
    {
      article_id: 14,
      evidence_snippet: "قوم يا عديم التربية",
      rationale_ar: "إهانة",
      canonical_atom: "insult",
      location: { start_offset: 100, end_offset: 200 }
    },
    // Case 3: Genuine adult insults (should be retained)
    {
      article_id: 14,
      evidence_snippet: "كلهم حرامية",
      rationale_ar: "إهانة للجهة",
      canonical_atom: "insult_adult",
      location: { start_offset: 850, end_offset: 870 }
    },
    // Case 4: Genuine public order (should be retained)
    {
      article_id: 15,
      evidence_snippet: "نستخدم حسابات وهمية، نكتب إشاعات",
      rationale_ar: "تحريض",
      canonical_atom: "incitement",
      location: { start_offset: 800, end_offset: 900 }
    }
  ];

  console.log("Testing deterministic ownership resolver...");
  const res = enforceDeterministicOwnership(findings as any, events as any, "mock chunk text");
  
  console.log("\nDiagnostics:");
  console.log(JSON.stringify(res.diagnostics, null, 2));

  console.log("\nRetained Findings:");
  res.finalFindings.forEach(f => {
    console.log(`Article ${f.article_id}: ${f.evidence_snippet}`);
  });
}

runTest();
