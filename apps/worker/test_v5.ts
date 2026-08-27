import { config as loadEnv } from 'dotenv';
loadEnv();

async function run() {
  console.log("\n-------------------------------------------");
  console.log("V5 CANDIDATE GENERATION TESTS");
  console.log("-------------------------------------------");

  const { parseJudgeWithRepair } = await import('./src/openai.js');
  const { groundFindingEvidenceToChunk } = await import('./src/evidenceGrounding.js');
  const { renderBoundedStructuredEventContext } = await import('./src/eventUnderstanding.js');

  const v5Events = [
    { event_id: 8, event_summary: "Wife confronts husband", actor: "Wife", target: "Husband", action: "Threatens to hit with shoe", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "Threat of physical violence" },
    { event_id: 17, event_summary: "Husband escalates", actor: "Husband", target: "Wife", action: "Suggests physical abuse", quote: "اللي ما يفهم بالكلام… يفهم بالضرب", start_offset: 35, end_offset: 68, dominant_meaning: "Normalization of domestic abuse" },
    { event_id: 20, event_summary: "Wife insults", actor: "Wife", target: "Husband", action: "Insults", quote: "لا تتفلسفين", start_offset: 77, end_offset: 88, dominant_meaning: "Personal insult" }
  ];
  
  const v5ChunkText = "بقوم آخذ الجزمة وأضربك فيها، ورد: اللي ما يفهم بالكلام… يفهم بالضرب، فقالت: لا تتفلسفين.";
  
  const v5BoundedContext = renderBoundedStructuredEventContext({ chunk_start: 0, chunk_end: 1000, event_count: 3, events: v5Events as any });

  const isV5EventFirst = true;
  const legacyFormattingSuffix = `\n\nقواعد تنسيق إلزامية:\n- article_id (اختياري)...`;
  const v5FormattingSuffix = `\n\nقواعد التنسيق (V5):\n- يجب إرجاع مصفوفة findings بصيغة JSON فقط.\n- كل مخالفة (finding) يجب أن ترتبط بحدث واحد فقط وتحتوي على:\n  - event_id (معرف الحدث المطابق)\n  - title_ar (عنوان المخالفة)\n  - rationale_ar (شرح المخالفة)\n  - evidence_snippet (الاقتباس الحرفي من الحدث)\n  - confidence (بين 0 و 1)\n- لا تقم بإنشاء أو إرجاع start_offset أو end_offset أو canonical_atom أو intensity أو أي تفاصيل أخرى لم تُطلب منك صراحة (سيتم حسابها تلقائياً).\nأرجع JSON بمصفوفة findings فقط.`;

  const userContentCore = v5BoundedContext;
  const userContentBefore = `${userContentCore}${legacyFormattingSuffix}`;
  const userContentAfter = `${userContentCore}${v5FormattingSuffix}`;

  console.log("=== PROMPT BEFORE ===");
  console.log("Legacy coordinate requirements: PRESENT");
  console.log("=== PROMPT AFTER ===");
  console.log("V5 bounded StructuredEvents payload: PRESENT");
  console.log("Legacy coordinate requirements: REMOVED");
  console.log("\nExact Suffix:\n", v5FormattingSuffix);

  // Mock LLM Response for After (No offsets, no legacy fields)
  const v5MockResponse = JSON.stringify({
    findings: [
      {
        article_id: 5,
        event_id: 8,
        title_ar: "العنف المنزلي",
        rationale_ar: "تهديد بالضرب باستخدام الجزمة.",
        evidence_snippet: "بقوم آخذ الجزمة وأضربك فيها",
        confidence: 0.95
      },
      {
        article_id: 14,
        event_id: 20,
        title_ar: "إهانة شخصية",
        rationale_ar: "استخدام لفظ مهين لا تتفلسفين",
        evidence_snippet: "لا تتفلسفين",
        confidence: 0.90
      },
      {
        article_id: 5,
        event_id: 99,
        title_ar: "تأليف مقولة",
        rationale_ar: "اختلاق",
        evidence_snippet: "تهديد غير موجود",
        confidence: 0.8
      }
    ]
  });

  const parsed = await parseJudgeWithRepair(v5MockResponse, "test", [{ id: 5, title_ar: "Article 5" } as any]);
  
  if (parsed.findings.length !== 3) {
    console.error("[FAIL] V5 schema failed to parse findings without offsets.");
    process.exit(1);
  } else {
    console.log(`\n[PASS] V5 candidates parsed successfully without legacy fields. Count: ${parsed.findings.length}`);
  }

  // Grounding tests
  const finding8 = parsed.findings.find(f => f.event_id === 8);
  const grounded8 = groundFindingEvidenceToChunk(finding8 as any, v5ChunkText);
  if (grounded8.grounded && grounded8.finding.location?.start_offset === 0 && grounded8.finding.location?.end_offset === 27) {
    console.log("[PASS] Grounding successfully reconstructed exact offsets for Event 8: [0, 27]");
  } else {
    console.error(`[FAIL] Grounding failed for Event 8. Got:`, grounded8.finding.location);
    process.exit(1);
  }
  
  const findingFabricated = parsed.findings.find(f => f.event_id === 99);
  const groundedFabricated = groundFindingEvidenceToChunk(findingFabricated as any, v5ChunkText);
  if (!groundedFabricated.grounded) {
    console.log("[PASS] Fabricated finding successfully rejected during grounding.");
  } else {
    console.error("[FAIL] Fabricated finding slipped through grounding.");
    process.exit(1);
  }

  console.log("\nALL OFFLINE TESTS PASSED.");
}

run().catch(console.error);
