import 'dotenv/config';
import { supabase } from './src/db.js';
import { DETECTION_PASSES } from './src/multiPassJudge.js';
import { buildEventUnderstandingPass, renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';
import { callJudgeRaw, parseJudgeWithRepair } from './src/openai.js';

async function run() {
  const jobId = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';
  console.log(`Fetching chunks for job ${jobId}...`);
  
  const { data: chunks, error } = await supabase
    .from('analysis_chunks')
    .select('*')
    .eq('job_id', jobId)
    .order('chunk_index')
    .limit(1);
    
  if (error || !chunks || chunks.length === 0) {
    console.error('Error fetching chunks:', error);
    return;
  }
  
  const chunkText = chunks[0].chunk_text_ar || chunks[0].text || chunks[0].chunk_text || "";
  console.log(`Chunk length: ${chunkText.length}`);
  
  console.log('Running Event Understanding extraction...');
  const euData = await buildEventUnderstandingPass(chunkText, 0, chunkText.length);
  console.log(`Structured events understood: ${euData.events?.length ?? 0}`);
  
  const pass = DETECTION_PASSES.find(p => p.name === 'v5_article_14');
  if (!pass) { console.error("Pass not found"); return; }

  const boundedContext = renderBoundedStructuredEventContext(euData);
  let systemPrompt = typeof pass.buildPrompt === "function" ? pass.buildPrompt() : "";

  console.log(`\n=== CALLING GPT-4.1 AS V5_ARTICLE_14 ===`);
  const res = await callJudgeRaw(
    chunkText,
    [{ id: 14, article_number: 14 } as any],
    0,
    chunkText.length,
    { judge_model: "gpt-4.1", temperature: 0.0, seed: 123 },
    systemPrompt,
    null,
    { isV5EventFirst: true, userContentOverride: boundedContext }
  );

  console.log('\n\n=== FINAL DIAGNOSTICS ===');
  console.log(`provider: ${res.provider}`);
  console.log(`model: ${res.model}`);
  console.log(`article_id: 14`);
  console.log(`isV5EventFirst: true`);
  console.log(`raw system prompt hash: ${res.system_prompt_hash}`);
  console.log(`raw user prompt hash: ${res.user_prompt_hash}`);
  console.log(`finishReason: ${res.finish_reason}`);
  console.log(`\nraw LLM response BEFORE parsing:`);
  console.log(res.raw_judge_response);

  console.log(`\n=== RUNNING PARSER ===`);
  const parsed = await parseJudgeWithRepair(
    res.raw_judge_response,
    systemPrompt,
    res.rendered_user_prompt,
    'v5_article_14',
    { judge_model: "gpt-4.1" },
    []
  );

  console.log(`parsed findings count: ${parsed.findings?.length ?? 0}`);
  console.log(`repaired findings count: ${parsed.is_repaired ? (parsed.findings?.length ?? 0) : 0}`);
  console.log(`exact output passed from runSinglePass to runMultiPassDetection:`);
  console.log(JSON.stringify(parsed.findings, null, 2));
}

run().catch(console.error);
