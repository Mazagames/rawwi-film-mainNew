import 'dotenv/config';
import { supabase } from './src/db.js';
import { DETECTION_PASSES } from './src/multiPassJudge.js';
import { buildEventUnderstandingPass, renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';
import { callJudgeRaw } from './src/openai.js';
import { parseJudgeOutput } from './src/schemas.js';

const MOCK_EVENTS = {
  understanding_layer: "semantic_event_understanding",
  one_event_one_finding: true,
  domain_neutrality: true,
  activeEvents: [
    {
      event_id: 1,
      scene_heading: "Confrontation",
      actor: "فهد",
      target: "مازن",
      action: "يصرخ",
      quote: "لا تتفلسفين... ما لكم فايدة في حياتي",
      previous_event_quote: null,
      next_event_quote: null
    },
    {
      event_id: 2,
      scene_heading: "Child abuse context",
      actor: "فهد",
      target: "الطفل",
      action: "يضرب",
      quote: "يضرب الطفل بقسوة ويحبسه في الغرفة المظلمة",
      previous_event_quote: "لا تتفلسفين... ما لكم فايدة في حياتي",
      next_event_quote: null
    }
  ]
};

async function testArticle(articleId: number, passName: string) {
  console.log(`\n======================================`);
  console.log(`Testing ${passName}`);
  console.log(`======================================`);
  
  const pass = DETECTION_PASSES.find(p => p.name === passName);
  if (!pass) { console.error("Pass not found"); return; }

  let systemPrompt = typeof pass.buildPrompt === "function" ? pass.buildPrompt() : "";
  const model = pass.model || "gpt-4.1";
  
  const boundedContext = JSON.stringify(MOCK_EVENTS, null, 2);

  const res = await callJudgeRaw(
    "",
    [{ id: articleId, article_number: articleId } as any],
    0,
    100,
    { judge_model: model, temperature: 0.0, seed: 123 },
    systemPrompt,
    null,
    { isV5EventFirst: true, userContentOverride: boundedContext }
  );

  console.log(`finish_reason: ${res.finish_reason}`);
  console.log(`resolved_model: ${res.model}`);
  
  // Parse findings
  try {
    const parsed = parseJudgeOutput(res.raw_judge_response);
    console.log(`Findings count: ${parsed.findings?.length || 0}`);
    console.log(JSON.stringify(parsed.findings, null, 2));
  } catch (err) {
    console.error("Failed to parse:", err);
    console.log(res.raw_judge_response);
  }
}

async function run() {
  await testArticle(14, 'v5_article_14');
  await testArticle(12, 'v5_article_12');
}

run().catch(console.error);
