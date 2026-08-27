import 'dotenv/config';
import { supabase } from './src/db.js';
import { DETECTION_PASSES } from './src/multiPassJudge.js';
import { buildEventUnderstandingPass, renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';
import { callJudgeRaw } from './src/openai.js';

async function run() {
  const jobId = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';
  console.log(`Fetching chunk for job ${jobId}...`);
  
  const { data: chunks } = await supabase
    .from('analysis_chunks')
    .select('*')
    .eq('job_id', jobId)
    .order('chunk_index')
    .limit(1);
    
  if (!chunks || chunks.length === 0) {
    console.error('No chunks found');
    return;
  }
  
  const chunkText = chunks[0].text || "";
  console.log(`Chunk length: ${chunkText.length}`);
  
  console.log('Running Event Understanding extraction...');
  const euData = await buildEventUnderstandingPass(chunkText, 0, chunkText.length);
  if (!euData.events || euData.events.length === 0) {
     console.error('Event extraction returned zero events');
     return;
  }
  console.log(`Structured events understood: ${euData.events.length}`);
  
  const pass = DETECTION_PASSES.find(p => p.name === 'v5_article_05');
  if (!pass) { console.error("Pass not found"); return; }

  const boundedContext = renderBoundedStructuredEventContext(euData);
  
  let systemPrompt = typeof pass.buildPrompt === "function" ? pass.buildPrompt() : "";
  const model = pass.model || "gpt-4.1";

  const res = await callJudgeRaw(
    chunkText,
    [{ id: 5, article_number: 5 } as any],
    0,
    chunkText.length,
    { judge_model: model, temperature: 0.0, seed: 123 },
    systemPrompt,
    null,  // userPromptAddition — set to null because V5 sets it null (line 1950 of multiPassJudge.ts)
    { isV5EventFirst: true, userContentOverride: boundedContext }
  );

  // Key diagnostics
  console.log('\n\n=== FINAL DIAGNOSTICS ===');
  console.log(`finish_reason: ${res.finish_reason}`);
  console.log(`raw_response_length: ${res.raw_judge_response.length}`);
  console.log(`raw_response: ${res.raw_judge_response.slice(0, 2000)}`);
  
  // Check which suffix was actually used
  const hasV5Suffix = res.rendered_user_prompt.includes('قواعد التنسيق (V5)');
  const hasLegacySuffix = res.rendered_user_prompt.includes('قواعد تنسيق إلزامية');
  console.log(`\nUSER PROMPT contains V5 suffix: ${hasV5Suffix}`);
  console.log(`USER PROMPT contains legacy suffix: ${hasLegacySuffix}`);
  
  // Check if structured events are in the user prompt
  const hasStructuredEvents = res.rendered_user_prompt.includes('semantic_event_understanding');
  console.log(`USER PROMPT contains structured events: ${hasStructuredEvents}`);
  
  // Print the last 1500 chars of the user prompt to see what suffix was appended
  console.log(`\n--- USER PROMPT TAIL (last 1500 chars) ---`);
  console.log(res.rendered_user_prompt.slice(-1500));
  
  // Print the SYSTEM PROMPT to see if there's a collision
  console.log(`\n--- SYSTEM PROMPT (first 500 chars) ---`);
  console.log(res.rendered_system_prompt.slice(0, 500));
  console.log(`\n--- SYSTEM PROMPT (last 500 chars) ---`);
  console.log(res.rendered_system_prompt.slice(-500));
}

run().catch(console.error);
