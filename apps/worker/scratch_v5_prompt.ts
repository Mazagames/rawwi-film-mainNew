import { config as loadEnv } from 'dotenv';
loadEnv();
import { parseJudgeWithRepair } from './src/openai.js';
import { getV5ReviewerDefinitions } from './src/v5PromptPack.js';
import { applyEarlyPassFilters } from './src/multiPassJudge.js';
import { renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';

async function main() {
  const events = [
    { event_id: 8, event_summary: "Wife confronts husband", actor: "Wife", target: "Husband", action: "Threatens to hit with shoe", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 10, end_offset: 38, dominant_meaning: "Threat of physical violence" },
    { event_id: 17, event_summary: "Husband escalates", actor: "Husband", target: "Wife", action: "Suggests physical abuse", quote: "اللي ما يفهم بالكلام… يفهم بالضرب", start_offset: 45, end_offset: 78, dominant_meaning: "Normalization of domestic abuse" },
    { event_id: 20, event_summary: "Wife insults", actor: "Wife", target: "Husband", action: "Insults", quote: "لا تتفلسفين", start_offset: 80, end_offset: 91, dominant_meaning: "Personal insult" }
  ];

  const chunkText = "بقوم آخذ الجزمة وأضربك فيها، ورد: اللي ما يفهم بالكلام… يفهم بالضرب، فقالت: لا تتفلسفين.";
  
  const boundedContext = renderBoundedStructuredEventContext({ chunk_start: 0, chunk_end: 1000, event_count: 3, events: events as any });

  const isV5EventFirst = true;
  const legacyFormattingSuffix = `\n\nقواعد تنسيق إلزامية:\n- article_id (اختياري)...`;
  const v5FormattingSuffix = `\n\nقواعد التنسيق (V5):\n- يجب إرجاع مصفوفة findings بصيغة JSON فقط.\n- كل مخالفة (finding) يجب أن ترتبط بحدث واحد فقط وتحتوي على:\n  - event_id (معرف الحدث المطابق)\n  - title_ar (عنوان المخالفة)\n  - rationale_ar (شرح المخالفة)\n  - evidence_snippet (الاقتباس الحرفي من الحدث)\n  - confidence (بين 0 و 1)\n- لا تقم بإنشاء أو إرجاع start_offset أو end_offset أو canonical_atom أو intensity أو أي تفاصيل أخرى لم تُطلب منك صراحة (سيتم حسابها تلقائياً).\nأرجع JSON بمصفوفة findings فقط.`;

  const userContentCore = boundedContext;
  const userContentBefore = `${userContentCore}${legacyFormattingSuffix}`;
  const userContentAfter = `${userContentCore}${v5FormattingSuffix}`;

  console.log("=== PROMPT BEFORE ===");
  console.log("Suffix ONLY:\n", legacyFormattingSuffix);
  console.log("=== PROMPT AFTER ===");
  console.log("Suffix ONLY:\n", v5FormattingSuffix);

  // Mock LLM Response for After (No offsets, no legacy fields)
  const mockResponse = JSON.stringify({
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

  const parsed = await parseJudgeWithRepair(mockResponse, "test", [{ id: 5, title_ar: "Article 5" } as any]);
  console.log("=== PARSED CANDIDATES ===");
  console.log(`Parsed count: ${parsed.findings.length}`);
  
  if (parsed.findings.length !== 3) {
    console.error("FAILED to parse findings.");
    process.exit(1);
  }

  const earlyPassed = applyEarlyPassFilters("v5_article_05", parsed.findings, chunkText);
  
  console.log("=== AFTER GROUNDING ===");
  console.log(`Grounded count: ${earlyPassed.length}`);
  if (earlyPassed.length !== 2) {
    console.error("FAILED to ground correctly.");
    process.exit(1);
  }

  const finding8 = earlyPassed.find(f => f.event_id === 8);
  if (finding8?.location?.start_offset === 0 && finding8?.location?.end_offset === 27) {
    console.log("Grounding successfully reconstructed exact offsets for Event 8: [0, 27]");
  }
  
  const findingFabricated = earlyPassed.find(f => f.event_id === 99);
  if (!findingFabricated) {
    console.log("Fabricated finding successfully rejected.");
  }
}
main().catch(console.error);
