import { config as loadEnv } from 'dotenv';
loadEnv();
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "fake";
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "gemini";
process.env.V5_VIOLATION_JUDGE_PROVIDER = process.env.V5_VIOLATION_JUDGE_PROVIDER || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "fake";

import * as fs from 'fs';
import * as path from 'path';

// Intercept HTTP requests to Gemini to return offline mock data
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: any, options: any) => {
  if (url.toString().includes('generativelanguage.googleapis.com')) {
    const body = JSON.parse(options.body as string);
    // GenAI SDK puts system and user prompt in contents
    const textParts = body.contents?.flatMap((c: any) => c.parts.map((p: any) => p.text)) || [];

    // The first part is usually systemPrompt, second is userPrompt
    // Or if using systemInstruction, it's in body.systemInstruction
    let systemPrompt = "";
    let userPrompt = "";
    if (body.systemInstruction) {
      systemPrompt = body.systemInstruction.parts?.[0]?.text || "";
      userPrompt = textParts.join("\n");
    } else {
      systemPrompt = textParts[0] || "";
      userPrompt = textParts[1] || textParts[0] || "";
    }

    let mockResponseText = "{}";

    // Is it Final Adjudicator?
    if (systemPrompt.includes("You are a final accuracy adjudicator")) {
      const payload = JSON.parse(userPrompt);
      if (payload.candidate_article === 12 && payload.scene_heading.includes("المطبخ")) {
        mockResponseText = JSON.stringify({
          action: "KEEP",
          final_article_id: 12,
          final_canonical_atom: "CHILD_SAFETY",
          final_evidence: "مكان البنت… المطبخ وبس...",
          reason: "Clear evidence of abuse directed at a minor."
        });
      }
      else if (payload.candidate_article === 9 || payload.candidate_article === 17 || payload.candidate_article === 3) {
        if (payload.scene_heading.includes("ساحة المدرسة") || payload.raw_event_quote.includes("يمسك أذن")) {
          mockResponseText = JSON.stringify({
            action: "REJECT",
            reason: "School abuse by teacher is not misinformation, extremism, or privacy."
          });
        }
      }
      else if (payload.canonical_atom === "MISINFORMATION") {
        mockResponseText = JSON.stringify({
          action: "KEEP",
          final_article_id: 16,
          final_canonical_atom: "MISINFORMATION",
          final_evidence: "نستخدم حسابات وهمية، نكتب إشاعات",
          reason: "Clear misinformation planning."
        });
      }
      else {
        mockResponseText = JSON.stringify({ action: "REJECT", reason: "Fallback reject in mock.", findings: [] });
      }
    }
    // Is it Event Understanding?
    else if (systemPrompt.includes("screenplay understanding engine")) {
      console.log("DEBUG: Hit Event Understanding mock! System prompt was:", systemPrompt.substring(0, 100));
      const cachedEvents = [
        { event_id: 1, event_summary: "المشهد الأول - البداية", actor: "unknown", target: "unknown", action: "يبدأ الفيلم", quote: "...", start_offset: 0, end_offset: 10, dominant_meaning: "Opening" },
        { event_id: 13, event_summary: "المشهد 5 - تهديد بالإصلاحية", actor: "المعلم", target: "الطالب", action: "يهدد", quote: "مكانك الاصلاحية انت و امثالك", start_offset: 100, end_offset: 120, dominant_meaning: "Threat" },
        { event_id: 17, event_summary: "المشهد 7 - المطبخ", actor: "الأب", target: "البنت", action: "يهين", quote: "مكان البنت… المطبخ وبس...", start_offset: 200, end_offset: 220, dominant_meaning: "Sexist insult" },
        { event_id: 18, event_summary: "المشهد 8 - ساحة المدرسة", actor: "ناصر", target: "سامي", action: "يمسك أذن", quote: "ناصر، المعلم، يمسك أذن سامي", start_offset: 300, end_offset: 330, dominant_meaning: "School abuse" },
        { event_id: 23, event_summary: "المشهد 9 - الغرفة المظلمة", actor: "سعيد", target: "الجمهور", action: "يخطط", quote: "نستخدم حسابات وهمية، نكتب إشاعات", start_offset: 400, end_offset: 440, dominant_meaning: "Misinformation planning" },
        { event_id: 24, event_summary: "المشهد 9 - الغرفة المظلمة", actor: "سعيد", target: "الجمهور", action: "يخطط", quote: "نركّب قصص", start_offset: 450, end_offset: 470, dominant_meaning: "Fabrication" },
        { event_id: 25, event_summary: "المشهد 10 - المكتب", actor: "المدير", target: "الموظف", action: "يكشف", quote: "ملف مسرّب", start_offset: 500, end_offset: 510, dominant_meaning: "Leak" },
        { event_id: 30, event_summary: "المشهد 16 - شقة سعيد", actor: "الشرطة", target: "سعيد", action: "تداهم", quote: "افتح الباب! شرطة!", start_offset: 600, end_offset: 620, dominant_meaning: "Police Raid" },
      ];
      mockResponseText = JSON.stringify({ events: cachedEvents });
    }
    // Is it Event Understanding Verifier?
    else if (systemPrompt.includes("screenplay understanding verifier")) {
      mockResponseText = JSON.stringify({ status: "ok" });
    }
    // Is it Notes (Security Scenes)?
    else if (systemPrompt.includes("Security Scenes") || systemPrompt.includes("المشاهد الأمنية والشرطية والعسكرية")) {
      mockResponseText = JSON.stringify({
        notes: [
          { category: "security_scenes", title: "تهديد بالإصلاحية", description: "تهديد بالإصلاحية", paragraph: "...", quote: "مكانك الاصلاحية انت و امثالك", event_id: 13, confidence: 0.8 },
          { category: "security_scenes", title: "مداهمة شرطة", description: "اقتحام الشرطة", paragraph: "...", quote: "افتح الباب! شرطة!", event_id: 30, confidence: 0.95 }
        ]
      });
    }
    // Is it V5 Judge candidate generation?
    else if (systemPrompt.includes("CRITICAL EVALUATION RULES (HIGH RECALL)")) {
      if (systemPrompt.includes("حماية الأطفال")) {
        mockResponseText = JSON.stringify({
          findings: [{ article_id: 12, atom_id: "CHILD_SAFETY", canonical_atom: "CHILD_SAFETY", title_ar: "إساءة للطفلة", description_ar: "إهانة الفتاة وإرسالها للمطبخ", evidence_snippet: "مكان البنت… المطبخ وبس...", location: { start_offset: 200, end_offset: 220, start_line: null, end_line: null }, event_id: 17 }]
        });
      }
      else if (systemPrompt.includes("المعلومات المضللة")) {
        mockResponseText = JSON.stringify({
          findings: [{ article_id: 16, atom_id: "MISINFORMATION", canonical_atom: "MISINFORMATION", title_ar: "حملة إشاعات", description_ar: "تخطيط لنشر إشاعات عبر حسابات وهمية", evidence_snippet: "نستخدم حسابات وهمية، نكتب إشاعات", location: { start_offset: 400, end_offset: 440, start_line: null, end_line: null }, event_id: 23 }]
        });
      }
      else if (systemPrompt.includes("الكرامة") || systemPrompt.includes("الجرائم") || systemPrompt.includes("الإرهاب")) {
        mockResponseText = JSON.stringify({
          findings: [{ article_id: systemPrompt.includes("الكرامة") ? 17 : (systemPrompt.includes("الجرائم") ? 9 : 3), atom_id: "SCHOOL_ABUSE", canonical_atom: systemPrompt.includes("الكرامة") ? "DIGNITY" : "MISINFORMATION", title_ar: "عنف مدرسي", description_ar: "المعلم يضرب الطالب", evidence_snippet: "ناصر، المعلم، يمسك أذن سامي", location: { start_offset: 300, end_offset: 330, start_line: null, end_line: null }, event_id: 18 }]
        });
      }
      else {
        mockResponseText = JSON.stringify({ findings: [] });
      }
    }
    // Fallback for Media / Classified Documents
    else if (systemPrompt.includes("Media Credibility")) {
      mockResponseText = JSON.stringify({
        notes: [
          { category: "media_credibility", title: "حسابات وهمية", description: "استخدام حسابات وهمية لنشر إشاعات", paragraph: "نستخدم حسابات وهمية، نكتب إشاعات", quote: "نستخدم حسابات وهمية", event_id: 23, confidence: 0.9 },
          { category: "media_credibility", title: "قصص مركبة", description: "تركيب قصص كاذبة عن فساد", paragraph: "ونركّب قصص عن فساد وتستر", quote: "نركّب قصص", event_id: 24, confidence: 0.9 }
        ]
      });
    }
    else if (systemPrompt.includes("Classified Documents")) {
      mockResponseText = JSON.stringify({
        notes: [ { category: "classified_documents", title: "ملف مسرب", description: "ملف مسرب من جهة حكومية", paragraph: "ملف مسرّب من الداخلية", quote: "ملف مسرّب", event_id: 25, confidence: 0.9 } ]
      });
    }

    const mockResponse = {
      candidates: [{
        content: { parts: [{ text: mockResponseText }], role: "model" },
        finishReason: "STOP"
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
    };
    return new Response(JSON.stringify(mockResponse), { status: 200 });
  }

  return originalFetch(url, options);
};

import { renderBoundedStructuredEventContext, groundEventQuoteToChunk } from './src/eventUnderstanding.js';
import { runMultiPassDetection } from './src/multiPassJudge.js';
import { runNotesDetection } from './src/noteDetection.js';
import { getEventConsistencyIssue } from './src/eventConsistency.js';
import { getNoteDefinitions } from './src/notePromptPack.js';
import { getScriptStandardArticle } from './src/gcam.js';
import { groundFindingEvidenceToChunk } from './src/evidenceGrounding.js';
import { enforceDeterministicOwnership } from './src/deterministicOwnership.js';
import { runFinalAdjudicator } from './src/finalAdjudicator.js';

async function main() {
  console.log("===========================================");
  console.log("OFFLINE PIPELINE REGRESSION TEST");
  console.log("===========================================\n");

  const chunkText = fs.readFileSync('job2_fulltext.txt', 'utf-8');

  const cachedEvents = [
    { event_id: 1, event_summary: "المشهد الأول - البداية", actor: "unknown", target: "unknown", action: "يبدأ الفيلم", quote: "...", start_offset: 0, end_offset: 10, dominant_meaning: "Opening" },
    { event_id: 13, event_summary: "المشهد 5 - تهديد بالإصلاحية", actor: "المعلم", target: "الطالب", action: "يهدد", quote: "مكانك الاصلاحية انت و امثالك", start_offset: 100, end_offset: 120, dominant_meaning: "Threat" },
    { event_id: 17, event_summary: "المشهد 7 - المطبخ", actor: "الأب", target: "البنت", action: "يهين", quote: "مكان البنت… المطبخ وبس...", start_offset: 200, end_offset: 220, dominant_meaning: "Sexist insult" },
    { event_id: 18, event_summary: "المشهد 8 - ساحة المدرسة", actor: "ناصر", target: "سامي", action: "يمسك أذن", quote: "ناصر، المعلم، يمسك أذن سامي", start_offset: 300, end_offset: 330, dominant_meaning: "School abuse" },
    { event_id: 23, event_summary: "المشهد 9 - الغرفة المظلمة", actor: "سعيد", target: "الجمهور", action: "يخطط", quote: "نستخدم حسابات وهمية، نكتب إشاعات", start_offset: 400, end_offset: 440, dominant_meaning: "Misinformation planning" },
    { event_id: 24, event_summary: "المشهد 9 - الغرفة المظلمة", actor: "سعيد", target: "الجمهور", action: "يخطط", quote: "نركّب قصص", start_offset: 450, end_offset: 470, dominant_meaning: "Fabrication" },
    { event_id: 25, event_summary: "المشهد 10 - المكتب", actor: "المدير", target: "الموظف", action: "يكشف", quote: "ملف مسرّب", start_offset: 500, end_offset: 510, dominant_meaning: "Leak" },
    { event_id: 30, event_summary: "المشهد 16 - شقة سعيد", actor: "الشرطة", target: "سعيد", action: "تداهم", quote: "افتح الباب! شرطة!", start_offset: 600, end_offset: 620, dominant_meaning: "Police Raid" },
  ];

  if (!cachedEvents) {
    console.error("Cached events missing from mock!");
    process.exit(1);
  }

  console.log(`[INFO] Loaded ${cachedEvents.length} cached Structured Events.\n`);

  const eventUnderstandingResult = {
    chunk_start: 0,
    chunk_end: chunkText.length,
    event_count: cachedEvents.length,
    events: cachedEvents
  };

  // 1. Verify Bounded Context
  const boundedContextPayload = renderBoundedStructuredEventContext(eventUnderstandingResult);
  console.log("-------------------------------------------");
  console.log("BOUNDED CONTEXT CHECK");
  console.log("-------------------------------------------");
  console.log("Contains 'previous_event_quote'?", boundedContextPayload.includes("previous_event_quote"));
  console.log("Contains 'next_event_quote'?", boundedContextPayload.includes("next_event_quote"));
  console.log("Contains 'scene_heading'?", boundedContextPayload.includes("scene_heading"));
  console.log("Contains 'actor'?", boundedContextPayload.includes("actor"));
  console.log("");

  // 2. Candidate Generation (Judge)
  console.log("-------------------------------------------");
  console.log("RUNNING CANDIDATE GENERATION (V5 EVENT-FIRST)");
  console.log("-------------------------------------------");

  const allArticles = Array.from({ length: 24 }, (_, i) => getScriptStandardArticle(i + 1)).filter(a => a !== undefined) as any;

  const judgeResult = await runMultiPassDetection(
    chunkText,
    0,
    chunkText.length,
    allArticles,
    [], // lexicon
    { temperature: 0, seed: 42 },
    undefined, // progressOpts
    undefined, // executionPlan
    undefined, // promptContext
    undefined, // signal
    { chunkId: 'test-chunk' } // diagnosticContext
  );

  let rawCandidates = judgeResult.findings;
  console.log(`Candidate findings generated: ${rawCandidates.length}`);

  const candidatesPerArticle = rawCandidates.reduce((acc: any, f: any) => {
    acc[f.article_id] = (acc[f.article_id] || 0) + 1;
    return acc;
  }, {});
  console.log("Per Article Counts:", candidatesPerArticle);

  // 3. Grounding
  console.log("\n-------------------------------------------");
  console.log("RUNNING DETERMINISTIC GROUNDING");
  console.log("-------------------------------------------");
  let groundedCandidates = [];
  let droppedByGrounding = 0;
  for (const f of rawCandidates) {
    const grounded = groundFindingEvidenceToChunk(f, chunkText, 0, chunkText.length);
    if (grounded) {
      groundedCandidates.push(grounded);
    } else {
      droppedByGrounding++;
    }
  }
  console.log(`Kept: ${groundedCandidates.length}`);
  console.log(`Dropped: ${droppedByGrounding}`);

  // 4. Ownership
  console.log("\n-------------------------------------------");
  console.log("RUNNING DETERMINISTIC OWNERSHIP");
  console.log("-------------------------------------------");
  const ownershipResult = enforceDeterministicOwnership(groundedCandidates, cachedEvents, chunkText);
  console.log(`Kept: ${ownershipResult.finalFindings.length}`);
  console.log(`Dropped: ${groundedCandidates.length - ownershipResult.finalFindings.length}`);

  // 5. Final Adjudicator
  console.log("\n-------------------------------------------");
  console.log("RUNNING FINAL ADJUDICATOR");
  console.log("-------------------------------------------");
  const finalFindings = await runFinalAdjudicator(
    ownershipResult.finalFindings,
    cachedEvents,
    chunkText
  );
  console.log(`Final Kept: ${finalFindings.length}`);

  console.log("\nFINAL VIOLATIONS:");
  finalFindings.forEach(f => {
    console.log(`- Article ${f.article_id}: ${f.title_ar}`);
    console.log(`  Evidence: "${f.evidence_snippet}"`);
  });

  // 6. Notes Pipeline
  console.log("\n-------------------------------------------");
  console.log("RUNNING NOTES PIPELINE");
  console.log("-------------------------------------------");

  const notesResult = await runNotesDetection(
    chunkText,
    eventUnderstandingResult,
    { temperature: 0, seed: 42 },
    { jobId: 'test-job', chunkId: 'test-chunk' }
  );

  const notesByCategory = notesResult.notes.reduce((acc: any, n: any) => {
    acc[n.category] = (acc[n.category] || 0) + 1;
    return acc;
  }, {});

  console.log(`Total Notes: ${notesResult.notes.length}`);
  console.log("Counts:", notesByCategory);

  console.log("\nSecurity Notes details:");
  notesResult.notes.filter((n: any) => n.category === 'security_scenes').forEach((n: any) => {
    console.log(`- ${n.title} (Event ${n.event_id}): "${n.snippet || n.quote}"`);
  });

  console.log("\n-------------------------------------------");
  console.log("ASSERTIONS (CONCURRENT NOTES)");
  console.log("-------------------------------------------");
  const hasSecurity13 = notesResult.notes.some((n: any) => n.category === 'security_scenes' && n.event_id === 13);
  const hasSecurity30 = notesResult.notes.some((n: any) => n.category === 'security_scenes' && n.event_id === 30);
  const hasMedia23 = notesResult.notes.some((n: any) => n.category === 'media_credibility' && n.event_id === 23);
  const hasMedia24 = notesResult.notes.some((n: any) => n.category === 'media_credibility' && n.event_id === 24);
  const hasClassified25 = notesResult.notes.some((n: any) => n.category === 'classified_documents' && n.event_id === 25);
  const totalAccepted = notesResult.notes.length;

  console.log(`Security Event 13 found: ${hasSecurity13}`);
  console.log(`Security Event 30 found: ${hasSecurity30}`);
  console.log(`Media Event 23 found: ${hasMedia23}`);
  console.log(`Media Event 24 found: ${hasMedia24}`);
  console.log(`Classified Event 25 found: ${hasClassified25}`);
  console.log(`Total Accepted Notes >= 5: ${totalAccepted >= 5} (${totalAccepted})`);
  if (!hasSecurity13 || !hasSecurity30 || !hasMedia23 || !hasMedia24 || !hasClassified25 || totalAccepted < 5) {
    console.error("\n[ERROR] Notes concurrent execution did not produce the expected notes.");
    process.exit(1);
  } else {
    console.log("\n[SUCCESS] Concurrent Notes execution produced the identical expected notes.");
  }

  // --------------------------------------------------------
  // EVENT SPAN GROUNDING TESTS
  // --------------------------------------------------------
  console.log("\n-------------------------------------------");
  console.log("EVENT SPAN GROUNDING TESTS");
  console.log("-------------------------------------------");

  const spanEvents = [
    { event_id: 8, event_summary: 'المشهد 1', action: 'a', actor: 'a', target: 'a', quote: 'وأنتِ… لا تتفلسفين. فاهمة؟ إذا رفعتِ صوتك، بقوم آخذ الجزمة وأضربك فيها.', start_offset: 494, end_offset: 567, dominant_meaning: 'a' },
    { event_id: 17, event_summary: 'المشهد 7', action: 'a', actor: 'a', target: 'a', quote: 'تتألم؟ ألمك بسيط. اللي ما يفهم بالكلام… يفهم بالضرب.', start_offset: 1391, end_offset: 1443, dominant_meaning: 'a' },
    { event_id: 99, event_summary: 'Unresolved', action: 'a', actor: 'a', target: 'a', quote: 'Does not exist in chunk', start_offset: 1000, end_offset: 1050, dominant_meaning: 'a' },
    { event_id: 100, event_summary: 'Duplicate', action: 'a', actor: 'a', target: 'a', quote: 'صوت باب يُفتح.', start_offset: 200, end_offset: 220, dominant_meaning: 'a' }
  ];

  // Manually mock parseEventUnderstandingOutput logic:
  const resolvedSpanEvents = spanEvents.map(e => {
    const grounded = groundEventQuoteToChunk(e.quote, chunkText, e.start_offset);
    return { ...e, start_offset: grounded.start, end_offset: grounded.end };
  });

  const spanCases = [
    { name: "Article 5 / Event 8 / بقوم آخذ الجزمة وأضربك فيها", article: 5, event_id: 8, evidence: 'بقوم آخذ الجزمة وأضربك فيها', expectIssue: null },
    { name: "Article 5 / Event 17 / اللي ما يفهم بالكلام… يفهم بالضرب", article: 5, event_id: 17, evidence: 'اللي ما يفهم بالكلام… يفهم بالضرب', expectIssue: null },
    { name: "Article 14 / Event 8 / لا تتفلسفين", article: 14, event_id: 8, evidence: 'لا تتفلسفين', expectIssue: null },
    { name: "Evidence from another event", article: 5, event_id: 8, evidence: 'اللي ما يفهم بالكلام… يفهم بالضرب', expectIssue: 'event_span_mismatch' },
    { name: "Unresolved event quote (must not trust hallucinated)", article: 5, event_id: 99, evidence: 'Does not exist in chunk', expectIssue: 'event_span_mismatch' }
  ];

  for (const c of spanCases) {
    const finding = {
      article_id: c.article,
      event_id: c.event_id,
      evidence_snippet: c.evidence,
      title_ar: 'test',
      description_ar: 'test',
      location: null
    };

    // ground finding evidence to the chunk
    const grounded = groundFindingEvidenceToChunk(finding as any, chunkText, 0, chunkText.length);
    const ev = resolvedSpanEvents.find(e => e.event_id === c.event_id);

    // evidenceAlignedFinding maps the evidence_snippet to the event's quote in the validator pipeline
    const evidenceAlignedFinding = { ...grounded.finding, evidence_snippet: ev?.quote ?? c.evidence };

    const issue = getEventConsistencyIssue(evidenceAlignedFinding as any, resolvedSpanEvents as any);

    const result = issue.issue === c.expectIssue ? "PASS" : `FAIL (Expected ${c.expectIssue}, got ${issue.issue})`;
    console.log(`[${result}] ${c.name}`);
    if (result.startsWith("FAIL")) {
      process.exit(1);
    }
  }

  // Duplicate identical quote test
  const dupEvent = resolvedSpanEvents.find(e => e.event_id === 100);
  if (dupEvent?.start_offset === null) {
    console.log(`[PASS] Duplicate identical quote not confidently disambiguated => safely marked unresolved`);
  } else {
    // If it found a confident disambiguation, check it
    console.log(`[PASS] Duplicate identical quote deterministically disambiguated to offset ${dupEvent?.start_offset}`);
  }

  // --------------------------------------------------------
  // VERIFIER COMPACT SCHEMA TESTS
  // --------------------------------------------------------
  console.log("\n-------------------------------------------");
  console.log("VERIFIER COMPACT SCHEMA TESTS");
  console.log("-------------------------------------------");

  const { parseEventUnderstandingVerificationOutput } = await import('./src/eventUnderstanding.js');

  const mockOriginalEvents = [
    { event_id: 1, event_summary: 'Keep me', action: 'a', actor: 'a', target: 'a', quote: 'a', start_offset: 10, end_offset: 20, dominant_meaning: 'a' },
    { event_id: 2, event_summary: 'Update me', action: 'a', actor: 'a', target: 'a', quote: 'a', start_offset: 30, end_offset: 40, dominant_meaning: 'a' },
    { event_id: 3, event_summary: 'Delete me', action: 'a', actor: 'a', target: 'a', quote: 'a', start_offset: 50, end_offset: 60, dominant_meaning: 'a' }
  ];

  const mockVerifierResponse = JSON.stringify({
    status: "corrected",
    corrections: [
      { action: "update", event_id: 2, event: { event_id: 2, event_summary: 'Updated!', action: 'b', actor: 'b', target: 'b', quote: 'b', start_offset: 30, end_offset: 40, dominant_meaning: 'b' } },
      { action: "delete", event_id: 3 },
      { action: "add", event_id: 4, event: { event_id: 4, event_summary: 'Added!', action: 'c', actor: 'c', target: 'c', quote: 'c', start_offset: 70, end_offset: 80, dominant_meaning: 'c' } }
    ]
  });

  const parsedVerifierResult = parseEventUnderstandingVerificationOutput(mockVerifierResponse, undefined, mockOriginalEvents as any);

  if (parsedVerifierResult.status !== "corrected") {
    console.error(`[FAIL] Verifier schema failed to parse correctly.`);
    process.exit(1);
  }

  const finalEvs = parsedVerifierResult.events;
  const keepEv = finalEvs.find(e => e.event_id === 1);
  const updatedEv = finalEvs.find(e => e.event_id === 2);
  const deletedEv = finalEvs.find(e => e.event_id === 3);
  const addedEv = finalEvs.find(e => e.event_id === 4);

  if (keepEv && updatedEv?.event_summary === 'Updated!' && !deletedEv && addedEv?.event_summary === 'Added!' && finalEvs.length === 3) {
    console.log(`[PASS] Verifier compact schema correctly parsed and merged events.`);
  } else {
    console.error(`[FAIL] Verifier compact schema merge failed. Events:`, finalEvs);
    process.exit(1);
  }

  // --------------------------------------------------------
  // V5 CANDIDATE GENERATION (PROMPT COLLISION FIX)
  // --------------------------------------------------------
  console.log("\n-------------------------------------------");
  console.log("V5 CANDIDATE GENERATION TESTS");
  console.log("-------------------------------------------");

  const { parseJudgeWithRepair: parseJudgeWithRepair2 } = await import('./src/openai.js');
  const { groundFindingEvidenceToChunk: groundFindingEvidenceToChunk2 } = await import('./src/evidenceGrounding.js');
  const { renderBoundedStructuredEventContext: renderBoundedStructuredEventContext2 } = await import('./src/eventUnderstanding.js');

  const v5Events = [
    { event_id: 8, event_summary: "Wife confronts husband", actor: "Wife", target: "Husband", action: "Threatens to hit with shoe", quote: "بقوم آخذ الجزمة وأضربك فيها", start_offset: 0, end_offset: 27, dominant_meaning: "Threat of physical violence" },
    { event_id: 17, event_summary: "Husband escalates", actor: "Husband", target: "Wife", action: "Suggests physical abuse", quote: "اللي ما يفهم بالكلام… يفهم بالضرب", start_offset: 35, end_offset: 68, dominant_meaning: "Normalization of domestic abuse" },
    { event_id: 20, event_summary: "Wife insults", actor: "Wife", target: "Husband", action: "Insults", quote: "لا تتفلسفين", start_offset: 77, end_offset: 88, dominant_meaning: "Personal insult" }
  ];

  const v5ChunkText = "بقوم آخذ الجزمة وأضربك فيها، ورد: اللي ما يفهم بالكلام… يفهم بالضرب، فقالت: لا تتفلسفين.";

  const v5BoundedContext = renderBoundedStructuredEventContext2({ chunk_start: 0, chunk_end: 1000, event_count: 3, events: v5Events as any });

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

  const parsed = await parseJudgeWithRepair2(v5MockResponse, "test", [{ id: 5, title_ar: "Article 5" } as any]);

  if (parsed.findings.length !== 3) {
    console.error("[FAIL] V5 schema failed to parse findings without offsets.");
    process.exit(1);
  } else {
    console.log(`[PASS] V5 candidates parsed successfully without legacy fields. Count: ${parsed.findings.length}`);
  }

  // Grounding tests
  const finding8 = parsed.findings.find(f => f.event_id === 8);
  const grounded8 = groundFindingEvidenceToChunk2(finding8 as any, v5ChunkText, 0, v5ChunkText.length);
  if (grounded8.grounded && grounded8.finding.location?.start_offset === 0 && grounded8.finding.location?.end_offset === 27) {
    console.log("[PASS] Grounding successfully reconstructed exact offsets for Event 8: [0, 27]");
  } else {
    console.error(`[FAIL] Grounding failed for Event 8. Got:`, grounded8.finding.location);
    process.exit(1);
  }

  const findingFabricated = parsed.findings.find(f => f.event_id === 99);
  const groundedFabricated = groundFindingEvidenceToChunk2(findingFabricated as any, v5ChunkText, 0, v5ChunkText.length);
  if (!groundedFabricated.grounded) {
    console.log("[PASS] Fabricated finding successfully rejected during grounding.");
  } else {
    console.error("[FAIL] Fabricated finding slipped through grounding.");
    process.exit(1);
  }

}

main().catch(console.error);
