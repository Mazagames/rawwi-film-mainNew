import { toNoteInsertRows, type NoteItem } from "./src/noteDetection.js";

// Mock the deduplication logic that is inside runNotesDetection
function mockDeduplicateNotes(allNotes: NoteItem[]) {
  const dedupGroups = new Map<string, NoteItem[]>();
  for (const note of allNotes) {
    const key =
      typeof note.event_id === "number"
        ? `event_${note.event_id}_${note.category}`
        : `quote_${note.quote?.trim() ?? ""}_${note.category}`;
    if (!dedupGroups.has(key)) {
      dedupGroups.set(key, []);
    }
    dedupGroups.get(key)!.push(note);
  }

  const deduplicatedNotes: NoteItem[] = [];
  const droppedNotes: { note: NoteItem; reason: string }[] = [];

  for (const [key, group] of dedupGroups.entries()) {
    if (group.length === 1) {
      deduplicatedNotes.push(group[0]);
    } else {
      group.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      deduplicatedNotes.push(group[0]);
      
      for (let i = 1; i < group.length; i++) {
        droppedNotes.push({ note: group[i], reason: "Duplicate note for the same event/quote" });
      }
    }
  }

  return { deduplicatedNotes, droppedNotes };
}

async function runTest() {
  const mockAiOutputNotes: NoteItem[] = [
    // 1. Weak الإصلاحية security candidate
    {
      reviewer: "notes_security_scenes",
      category: "security_scenes",
      title: "تهديد بالإصلاحية",
      description: "تهديد طفل بالإصلاحية",
      paragraph: "مكانك الاصلاحية انت وامثالك",
      quote: "مكانك الاصلاحية انت وامثالك",
      event_id: 1, // Let's say event 1 is verbal abuse
      confidence: 0.6,
      status: "new",
      included_in_report: true,
    },
    // 2. Strong Scene 16 police/security event (First pass)
    {
      reviewer: "notes_security_scenes",
      category: "security_scenes",
      title: "مداهمة أمنية",
      description: "مشهد مداهمة لقوات الأمن",
      paragraph: "سيارتان أمنيتان تتوقفان بدون أضواء. رجال بلباس مدني ينزلون بهدوء.",
      quote: "سيارتان أمنيتان تتوقفان بدون أضواء",
      event_id: 16,
      confidence: 0.9,
      status: "new",
      included_in_report: true,
    },
    // 3. Strong Scene 16 police/security event (Duplicate from same event, maybe lower confidence)
    {
      reviewer: "notes_security_scenes",
      category: "security_scenes",
      title: "رائد شرطة",
      description: "تدخل رائد شرطة",
      paragraph: "سيارتان أمنيتان تتوقفان بدون أضواء. رجال بلباس مدني ينزلون بهدوء.",
      quote: "رجال بلباس مدني ينزلون بهدوء",
      event_id: 16,
      confidence: 0.8,
      status: "new",
      included_in_report: true,
    },
    // 4. Scene 21 visual review (مراجعة بصرية مطلوبة)
    {
      reviewer: "visual_review",
      category: "visual_review",
      title: "مراجعة بصرية",
      description: "يتطلب المشهد مراجعة بصرية",
      paragraph: "[مراجعة بصرية مطلوبة — الملابس / الحركة / زاوية التصوير]",
      quote: "مراجعة بصرية مطلوبة",
      event_id: 21,
      confidence: 0.95,
      status: "new",
      included_in_report: true,
    },
    // 5. Scene 22 copyright/IP event (Classified documents/IP)
    {
      reviewer: "article_21_classified_documents",
      category: "classified_documents",
      title: "استخدام غير مصرح به",
      description: "استخدام مواد محمية",
      paragraph: "وهذا الفيلم؟ نسخة كاملة. نستخدم منه المشهد ونركبه في إعلاننا.",
      quote: "نسخة كاملة. نستخدم منه المشهد ونركبه في إعلاننا.",
      event_id: 22,
      confidence: 0.85,
      status: "new",
      included_in_report: true,
    }
  ];

  console.log(`Input mock note count: ${mockAiOutputNotes.length}`);
  
  const { deduplicatedNotes, droppedNotes } = mockDeduplicateNotes(mockAiOutputNotes);

  console.log(`Retained count: ${deduplicatedNotes.length}`);
  console.log(`Deduplicated/dropped count: ${droppedNotes.length}`);
  
  console.log("\nRetained security evidence (security_scenes):");
  deduplicatedNotes.filter(n => n.category === "security_scenes").forEach(n => {
    console.log(`- Event ${n.event_id}: ${n.quote}`);
  });

  console.log("\nExact retained Scene 21 and Scene 22 evidence:");
  deduplicatedNotes.filter(n => n.event_id === 21 || n.event_id === 22).forEach(n => {
    console.log(`- Scene ${n.event_id} (${n.category}): ${n.quote}`);
  });

  console.log("\nDropped notes and reasons:");
  droppedNotes.forEach(d => {
    console.log(`- Dropped Note (Event ${d.note.event_id}): ${d.note.title}. Reason: ${d.reason}`);
  });
}

runTest();
