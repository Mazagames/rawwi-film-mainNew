import { config as loadEnv } from 'dotenv';
loadEnv();

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

import { renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';
import { runMultiPassDetection } from './src/multiPassJudge.js';
import { runNotesDetection } from './src/noteDetection.js';
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

}

main().catch(console.error);
