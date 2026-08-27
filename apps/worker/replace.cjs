const fs = require('fs');
let content = fs.readFileSync('src/openai.ts', 'utf8');

content = content.replace('import OpenAI from "openai";', 'import { generateStructuredCompletion } from "./aiClient.js";');
content = content.replace(/const openai = new OpenAI\(\{[^}]+\}\);\n/, '');

// callRouter
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\n\s*const raw = resp\.choices\[0\]\?\.message\?\.content \?\? "\{\}";/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_ROUTER_MODEL : jobConfig.router_model,
    systemPrompt: routerSystemPrompt || ROUTER_SYSTEM_MSG,
    userPrompt: userContent,
    temperature: jobConfig.temperature,
    seed: jobConfig.seed,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  const raw = resp.content ?? "{}";`
);

// callJudgeRaw
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\n\s*const content = resp\.choices\[0\]\?\.message\?\.content \?\? '\{"findings":\[\]\}';\n\s*const finishReason = resp\.choices\[0\]\?\.finish_reason \?\? null;\n\s*const usage = resp\.usage\n\s*\?\s*\{\n\s*prompt_tokens: resp\.usage\.prompt_tokens,\n\s*completion_tokens: resp\.usage\.completion_tokens,\n\s*total_tokens: resp\.usage\.total_tokens,\n\s*\}\n\s*: null;\n\s*const responseId = resp\.id \?\? null;/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : jobConfig.judge_model,
    systemPrompt: systemPrompt,
    userPrompt: userContent,
    temperature: jobConfig.temperature,
    seed: jobConfig.seed,
    maxTokens: 4096,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  const content = resp.content ?? '{"findings":[]}';
  const finishReason = resp.finishReason;
  const usage = resp.usage;
  const responseId = resp.responseId;`
);

// callRepairJson
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\s*return resp\.choices\[0\]\?\.message\?\.content \?\? "\{\}";/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : model,
    systemPrompt: REPAIR_SYSTEM,
    userPrompt: \`Context: \${context}\\n\\nBroken JSON:\\n\${slice}\\n\\nReturn the corrected JSON only.\`,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  return resp.content ?? "{}";`
);

// callAuditorRaw
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\s*return resp\.choices\[0\]\?\.message\?\.content \?\? '\{"assessments":\[\]\}';/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_AUDITOR_MODEL : model,
    systemPrompt: auditorSystemPrompt || AUDITOR_SYSTEM_MSG,
    userPrompt: \`المرشحات القانونية canonical:\\n\${clippedPayload}\\n\\n\${
          clippedAuditorContext
            ? \`سياق إضافي للمراجع (Pipeline V2):\\n\${clippedAuditorContext}\\n\\n\`
            : ""
        }مقتطف النص الكامل:\\n\${clippedText}\\n\\nأرجع JSON فقط. كل assessment يجب أن يحتوي حقل rationale_ar مملوءاً (جملة أو جملتان بالعربية: أين في النص، ماذا يعني في السياق، ولماذا اعتُبرت مخالفة أو تحتاج مراجعة). إذا وُجد سياق إضافي للمراجع فاستخدمه فقط لفهم الحبكة، نبرة المشهد، وموقف السرد؛ ولا تعتمد عليه كدليل حرفي ما لم يكن النص الحرفي موجوداً أيضاً في المقتطف الحالي. مثال: "المقتطف من مشهد حلم يصف ضحية طعن؛ السياق درامي ولا يروّج للعنف لكن الوصف يتجاوز ضوابط مادة 9."\`,
    temperature: 0,
    seed: 12345,
    maxTokens: 8192,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  return resp.content ?? '{"assessments":[]}';`
);

// callRationaleOnly
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\s*const raw = resp\.choices\[0\]\?\.message\?\.content \?\? "\{\}";/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_RATIONALE_MODEL : model,
    systemPrompt: RATIONALE_ONLY_SYSTEM_MSG,
    userPrompt: \`اكتب rationale_ar لكل عنصر بالعربية (جملة أو جملتان). أرجع JSON فقط: {"rationales":[{"canonical_finding_id":"...","rationale_ar":"..."}] }\\n\\nالعناصر:\\n\\n\${payload}\`,
    temperature: 0,
    seed: 12345,
    maxTokens: 3072,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  const raw = resp.content ?? "{}";`
);

// callRevisitSpotter
content = content.replace(
  /const resp = await openai\.chat\.completions\.create\(\{[\s\S]*?\}, \{ timeout: config\.JUDGE_TIMEOUT_MS, signal: options\.signal \}\);\n\s*const raw = resp\.choices\[0\]\?\.message\?\.content \?\? "\{\}";/,
  `const resp = await generateStructuredCompletion({
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_ROUTER_MODEL : model, // Fallback to router model which is mini
    systemPrompt: REVISIT_SPOTTER_SYSTEM,
    userPrompt: userContent,
    temperature: 0,
    maxTokens: 2048,
    timeoutMs: config.JUDGE_TIMEOUT_MS,
    signal: options.signal,
  });
  const raw = resp.content ?? "{}";`
);

fs.writeFileSync('src/openai.ts', content, 'utf8');
