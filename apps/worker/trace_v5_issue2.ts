import 'dotenv/config';
import { DETECTION_PASSES } from './src/multiPassJudge.js';
import { callJudgeRaw } from './src/openai.js';
import { parseJudgeOutput } from './src/schemas.js';

const MOCK_EVENTS = {
  understanding_layer: "semantic_event_understanding",
  activeEvents: [
    {
      event_id: 17,
      scene_heading: "المطبخ",
      actor: "الأم",
      target: "الابنة",
      action: "تعنيف لغوي وجسدي",
      quote: "مكان البنت… المطبخ وبس. مفهوم؟",
      start_offset: 100,
      end_offset: 150,
      dominant_meaning: "تقييد وتهميش وحصر دور الفتاة"
    },
    {
      event_id: 20,
      scene_heading: "الشارع",
      actor: "شخص",
      target: "شخص آخر",
      action: "شتم مباشر",
      quote: "يا ابن الكلب يا حقير",
      start_offset: 200,
      end_offset: 230,
      dominant_meaning: "إهانة وشتم"
    }
  ]
};

// Manually copy applyEarlyPassFilters logic from multiPassJudge.ts
function applyEarlyPassFilters(passName: string, findings: any[]) {
  const subject = DETECTION_PASSES.find(p => p.name === passName);
  if (!subject) throw new Error("Pass not found: " + passName);

  let dropped = 0;
  const kept = [];
  for (const finding of findings) {
    const findingArticleId = finding.article_id;
    if (!subject.articleIds.includes(findingArticleId ?? -1)) {
      console.log(`[EARLY FILTER DROP] article_id mismatch. Expected one of [${subject.articleIds.join(',')}], got: ${findingArticleId}`);
      dropped++;
      continue;
    }
    kept.push(finding);
  }
  return { filtered: kept, dropped };
}

async function runPass(passName: string) {
  console.log(`\n========================================`);
  console.log(`Tracing Pass: ${passName}`);
  console.log(`========================================`);

  const pass = DETECTION_PASSES.find(p => p.name === passName);
  if (!pass) {
     console.log("Passes available:", DETECTION_PASSES.map(p => p.name));
     throw new Error("Pass not found: " + passName);
  }

  const prompt = pass.buildPrompt([], []); // V5 ignores articles/lexicon and uses its markdown file
  const eventContext = JSON.stringify(MOCK_EVENTS, null, 2);
  const fullPrompt = `${prompt}\n\n=== EVENTS ===\n${eventContext}`;

  console.log("Calling Judge...");
  const rawResponseResult = await callJudgeRaw(
    "", // chunkText
    [], // selectedArticles
    0, // globalStart
    0, // globalEnd
    { judge_model: pass.model || "gpt-4.1", temperature: 0, seed: 123 }, // jobConfig
    prompt, // judgeSystemPrompt
    null, // userPromptAddition
    { userContentOverride: eventContext, isV5EventFirst: true } // options
  );
  const rawResponse = rawResponseResult.raw_judge_response;
  console.log("\n--- RAW RESPONSE ---");
  console.log(rawResponse);
  console.log("--------------------\n");

  const parsed = parseJudgeOutput(rawResponse);
  console.log("--- PARSED JSON ---");
  console.log(JSON.stringify(parsed, null, 2));
  console.log("-------------------\n");

  const findings = parsed.findings || [];
  if (findings.length === 0) {
    console.log("Conclusion: Raw response yielded 0 findings (or parsed as []).");
  } else {
    console.log(`Parsed ${findings.length} findings. Checking early pass filter...`);
    for (const f of findings) {
      console.log(`- Finding Title: ${f.title_ar}, article_id: ${f.article_id}`);
    }
    
    const { filtered, dropped } = applyEarlyPassFilters(passName, findings);
    console.log(`\nAfter early filter: ${filtered.length} kept, ${dropped} dropped.`);
    
    if (dropped > 0) {
      console.log("Conclusion: Valid finding IS being dropped by early pass filter (e.g. article_id mismatch)!");
    } else {
      console.log("Conclusion: Finding passed the early filter correctly.");
    }
  }
}

async function main() {
  await runPass("v5_article_12");
  await runPass("v5_article_14");
}

main().catch(console.error);
