import 'dotenv/config';
import { supabase } from './src/db.js';
import { DETECTION_PASSES } from './src/multiPassJudge.js';
import { renderBoundedStructuredEventContext } from './src/eventUnderstanding.js';
import { callJudgeRaw } from './src/openai.js';

async function run() {
  const jobId = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';
  console.log(`Fetching chunks for job ${jobId}...`);
  
  const { data: chunks, error } = await supabase
    .from('analysis_chunks')
    .select('*')
    .eq('job_id', jobId)
    .order('chunk_index');
    
  if (error || !chunks || chunks.length === 0) {
    console.error('Error fetching chunks:', error);
    return;
  }
  
  const chunk = chunks[0];
  console.log(`Chunk keys: ${Object.keys(chunk).join(', ')}`);
  const chunkText = chunk.chunk_text_ar || chunk.text || chunk.chunk_text || "";
  console.log(`Chunk 0 length: ${chunkText.length}`);
  
  // Also fetch the events that were understood for this chunk (from analysis_chunk_runs)
  const { data: runs } = await supabase
    .from('analysis_chunk_runs')
    .select('truth_layer_meta')
    .eq('job_id', jobId)
    .eq('chunk_id', chunk.id)
    .single();
    
  const truthMeta = runs?.truth_layer_meta as any;
  const structuredEvents = truthMeta?.structured_events;
  
  if (!structuredEvents || !Array.isArray(structuredEvents)) {
    console.log("No structured events found in truth_layer_meta. Cannot run V5 detection properly!");
    return;
  }
  console.log(`Found ${structuredEvents.length} structured events.`);

  const pass = DETECTION_PASSES.find(p => p.name === 'v5_article_05');
  if (!pass) {
    console.error("v5_article_05 pass not found");
    return;
  }
  
  const boundedContext = renderBoundedStructuredEventContext(
    pass,
    chunkText,
    0, // start
    structuredEvents
  );
  
  console.log(`Bounded events for article_05: ${boundedContext.activeEvents.length}`);

  let systemPrompt = typeof pass.systemPrompt === "function" ? pass.systemPrompt() : pass.systemPrompt;
  let userPrompt = typeof pass.userPrompt === "function" ? pass.userPrompt(chunkText) : chunkText;
  const model = pass.model || "gpt-4.1";
  const isV5EventFirst = true;

  console.log('--- TRACING V5_ARTICLE_05 ---');
  console.log(`Did the call execute? YES (simulating exactly what the pipeline does)`);
  console.log(`Exact model/provider used: ${model}`);
  console.log(`Exact isV5EventFirst value passed to callJudgeRaw: ${isV5EventFirst}`);
  
  const res = await callJudgeRaw({
    systemPrompt,
    userPrompt,
    model,
    passName: pass.name,
    isV5EventFirst,
    structuredEventContext: boundedContext,
    jobId,
    chunkId: chunk.id
  });

  console.log('--- RESULT ---');
  console.log(`finishReason: ${res.finishReason}`);
  console.log(`Parsed findings count: ${res.findings.length}`);
  console.log(`Raw Response: \n${res.rawResponse}`);
  
  if (res.rawResponse === "") {
     console.log("WAIT, RAW RESPONSE IS EMPTY! Check diagnostics");
  }
}

run().catch(console.error);
