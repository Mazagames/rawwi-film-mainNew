import 'dotenv/config';
import { runFinalAdjudicator } from './src/finalAdjudicator.js';

const mockEvents: any[] = [
  {
    event_id: 1,
    quote: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب.\nناصر: بكرة تتعلمون… اللي ما يحترم النظام… ينكسر",
    event_summary: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي",
    actor: "ناصر",
    target: "سامي",
  },
  {
    event_id: 2,
    quote: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي\nسامي نائم وهو واقف تقريبًا",
    event_summary: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي",
    actor: "سامي",
    target: "None",
  },
  {
    event_id: 3,
    quote: "طالبة (ريم، 12 سنة) ترفع يدها:\nريم: أستاذ… عيب… هو طفل.\nناصر يحدق فيها:",
    event_summary: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي",
    actor: "ريم",
    target: "ناصر",
  },
  {
    event_id: 4,
    quote: "ناصر: وأنتِ؟ تسوين نفسك بطلة؟ مكان البنت… المطبخ وبس.\nريم تسكت، محمرة.",
    event_summary: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي",
    actor: "ناصر",
    target: "ريم",
  },
  {
    event_id: 5,
    quote: "لخبطة",
    event_summary: "Unknown",
    actor: "Unknown",
    target: "Unknown",
  }
];

const findings: any[] = [
  {
    finding_uuid: "f1",
    article_id: 3,
    canonical_atom: "EXTREMISM",
    evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب.\nناصر: بكرة تتعلمون… اللي ما يحترم النظام… ينكسر",
    location: { v3: { event_id: 1 } },
  },
  {
    finding_uuid: "f2",
    article_id: 9,
    canonical_atom: "MISINFORMATION",
    evidence_snippet: "المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي\nسامي نائم وهو واقف تقريبًا",
    location: { v3: { event_id: 2 } },
  },
  {
    finding_uuid: "f3",
    article_id: 9,
    canonical_atom: "MISINFORMATION",
    evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب.\nناصر: بكرة تتعلمون… اللي ما يحترم النظام… ينكسر",
    location: { v3: { event_id: 1 } },
  },
  {
    finding_uuid: "f4",
    article_id: 12,
    canonical_atom: "CHILD_SAFETY",
    evidence_snippet: "مكان البنت… المطبخ وبس.\nريم تسكت، محمرة.\n\nالمشهد 16 — داخلي/خارجي — مداهمة / مركز شرطة — ليل متأخر",
    location: { v3: { event_id: 4 } },
  },
  {
    finding_uuid: "f5",
    article_id: 15,
    canonical_atom: "PUBLIC_ORDER",
    evidence_snippet: "لخبطة",
    location: { v3: { event_id: 5 } },
  },
  {
    finding_uuid: "f6",
    article_id: 17,
    canonical_atom: "PRIVACY",
    evidence_snippet: "ناصر، المعلم، يمسك أذن سامي أمام الطلاب.\nناصر: بكرة تتعلمون… اللي ما يحترم النظام… ينكسر",
    location: { v3: { event_id: 1 } },
  }
];

const mockChunkText = `
المشهد 7 — خارجي — ساحة المدرسة — صباح اليوم التالي
سامي نائم وهو واقف تقريبًا
ناصر، المعلم، يمسك أذن سامي أمام الطلاب.
ناصر: بكرة تتعلمون… اللي ما يحترم النظام… ينكسر
طالبة (ريم، 12 سنة) ترفع يدها:
ريم: أستاذ… عيب… هو طفل.
ناصر يحدق فيها:
ناصر: وأنتِ؟ تسوين نفسك بطلة؟ مكان البنت… المطبخ وبس.
ريم تسكت، محمرة.
لخبطة
`;

async function runTest() {
  console.log(`Starting offline adjudicator regression on 6 candidates...`);
  const finalFindings = await runFinalAdjudicator(findings, mockEvents as any, mockChunkText);
  console.log(`\nSurviving findings: ${finalFindings.length}`);
  for (const f of finalFindings) {
    console.log(`Article ${f.article_id} (${f.canonical_atom})`);
    console.log(`Final Evidence: ${f.evidence_snippet}`);
  }
}

runTest();
