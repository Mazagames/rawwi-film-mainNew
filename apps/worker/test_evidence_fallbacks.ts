import { groundFindingEvidenceToChunk } from "./src/evidenceGrounding";
import { JudgeFinding } from "./src/types";

const chunkText = `
المشهد 1
أحمد: مرحباً يا صديقي، كيف حالك اليوم؟
سالم: أنا بخير، شكراً لك. لقد كان يوماً طويلاً.
أحمد: هل سمعت الأخبار؟ لقد تم تأجيل الاجتماع.
سالم: نعم، سمعت ذلك. هذا جيد، يعطينا وقتاً أكثر للتحضير.
أنا ما—
فهد:
 لا تكذبين!
 سمعت إنك تتكلمين!
 تبي تفضحيني؟!
يمسك ذراعها بقوة.
مها:
 آه… فهد… بالله—
فهد:
 أنتِ ما لك كلمة
`;

function testFinding(testName: string, rawEvidence: string, startOffset: number, endOffset: number) {
  console.log(`\n--- TEST: ${testName} ---`);
  console.log(`Raw Evidence: "${rawEvidence}"`);
  console.log(`Offsets: ${startOffset} - ${endOffset}`);
  
  const finding = {
    evidence_snippet: rawEvidence,
    location: { start_offset: startOffset, end_offset: endOffset }
  } as unknown as JudgeFinding;

  const result = groundFindingEvidenceToChunk(finding, chunkText, []);
  console.log(`Grounded: ${result.grounded}`);
  console.log(`Method: ${result.method}`);
  console.log(`Result Snippet: "${result.finding?.evidence_snippet}"`);
  if (!result.grounded) {
    console.log(`Reason: ${result.reason}`);
  }
}

async function runTests() {
  const f1_start = chunkText.indexOf("أحمد: هل سمعت الأخبار؟");
  const f1_end = f1_start + "أحمد: هل سمعت الأخبار؟ لقد تم تأجيل الاجتماع.".length;

  testFinding(
    "Exact match",
    "أحمد: هل سمعت الأخبار؟ لقد تم تأجيل الاجتماع.",
    f1_start,
    f1_end
  );

  testFinding(
    "0% overlap (Pure Hallucination with unrelated offsets)",
    "خلهم يطلعون للشارع.",
    f1_start,
    f1_end
  );

  testFinding(
    "Weak/generic-word overlap (< 25%)",
    "قال أحمد كلاماً غير مفهوم", // "أحمد" might overlap, but it's very weak
    f1_start,
    f1_end
  );

  testFinding(
    "Moderate overlap (~30-50%)",
    "أحمد سمع الأخبار والاجتماع", 
    f1_start,
    f1_end
  );

  testFinding(
    "Strong overlap (>75% token recall)",
    "أحمد: هل سمعت الأخبار؟ لقد تأجل الاجتماع.", 
    f1_start,
    f1_end
  );

  const f2_start = chunkText.indexOf("أنا ما—");
  const f2_end = f2_start + "أنا ما—\nفهد:\n لا تكذبين!".length;

  testFinding(
    "Hallucinated text + random offsets",
    "نستخدم حسابات وهمية، نكتب إشاعات",
    f2_start,
    f2_end
  );

  testFinding(
    "Valid model text + correct offsets",
    "أنا ما—\nفهد:\n لا تكذبين!",
    f2_start,
    f2_end
  );
}

runTests();
