import fs from 'fs';

let mp = fs.readFileSync('src/multiPassJudge.ts', 'utf8');

const searchMP = `    const judgeCall = await callJudgeRaw(
      chunkText,
      articles,
      chunkStart,
      chunkEnd,
      { judge_model: model, temperature: jobConfig.temperature, seed: jobConfig.seed, analysis_signature_context: jobConfig.analysis_signature_context ?? null },
      prompt,
      userPromptAddition,
      { signal, userContentOverride: reviewerInputOverride }
    );
    throwIfAborted(signal);
    if (diagnosticContext) {
      await persistJudgeDiagnostic({
        diagnostic_kind: "raw_judge_snapshot",
        job_id: diagnosticContext.jobId,
        chunk_id: diagnosticContext.chunkId,
        pass_name: pass.name,
        prompt_hash: judgeCall.prompt_hash ?? "",
        router_candidates: diagnosticContext.routerCandidates,
        raw_judge_response: judgeCall.raw_judge_response,
        rendered_system_prompt: judgeCall.rendered_system_prompt,
        rendered_user_prompt: judgeCall.rendered_user_prompt,
        parsed_judge_response: null,
        judge_model: judgeCall.model,
        finish_reason: judgeCall.finish_reason,
        openai_usage: judgeCall.usage,
        openai_response_id: judgeCall.response_id,
        raw_response_timestamp: judgeCall.response_timestamp,
      });
    }

    // Parse findings
    const { findings, diagnostics } = await parseJudgeWithRepair(judgeCall.raw_judge_response, model, { signal });
    
    logger.info("Judge Call Diagnostics", {
      provider: config.AI_PROVIDER,
      configuredModel: model,
      resolvedModel: judgeCall.model,
      promptTokens: judgeCall.usage?.prompt_tokens ?? null,
      outputTokens: judgeCall.usage?.completion_tokens ?? null,
      thoughtsTokens: (judgeCall.usage as any)?.thoughts_tokens ?? null,
      totalTokens: judgeCall.usage?.total_tokens ?? null,
      maxTokens: 8192,
      finishReason: judgeCall.finish_reason,
      repairAttempts: diagnostics.repair_invoked ? 1 : 0,
      totalDurationMs: Date.now() - startTime,
    });`;

const replaceMP = `    let judgeCall: Awaited<ReturnType<typeof callJudgeRaw>> | undefined;
    let repairAttempts = 0;
    
    try {
      judgeCall = await callJudgeRaw(
        chunkText,
        articles,
        chunkStart,
        chunkEnd,
        { judge_model: model, temperature: jobConfig.temperature, seed: jobConfig.seed, analysis_signature_context: jobConfig.analysis_signature_context ?? null },
        prompt,
        userPromptAddition,
        { signal, userContentOverride: reviewerInputOverride }
      );
      throwIfAborted(signal);
      if (diagnosticContext) {
        await persistJudgeDiagnostic({
          diagnostic_kind: "raw_judge_snapshot",
          job_id: diagnosticContext.jobId,
          chunk_id: diagnosticContext.chunkId,
          pass_name: pass.name,
          prompt_hash: judgeCall.prompt_hash ?? "",
          router_candidates: diagnosticContext.routerCandidates,
          raw_judge_response: judgeCall.raw_judge_response,
          rendered_system_prompt: judgeCall.rendered_system_prompt,
          rendered_user_prompt: judgeCall.rendered_user_prompt,
          parsed_judge_response: null,
          judge_model: judgeCall.model,
          finish_reason: judgeCall.finish_reason,
          openai_usage: judgeCall.usage,
          openai_response_id: judgeCall.response_id,
          raw_response_timestamp: judgeCall.response_timestamp,
        });
      }

      // Parse findings
      const { findings, diagnostics } = await parseJudgeWithRepair(judgeCall.raw_judge_response, model, { signal });
      repairAttempts = diagnostics.repair_invoked ? 1 : 0;
      
      logger.info("Judge Call Diagnostics", {
        jobId: diagnosticContext?.jobId ?? null,
        chunkId: diagnosticContext?.chunkId ?? null,
        passName: pass.name,
        articleId: articleIds[0] ?? null,
        provider: config.AI_PROVIDER,
        configuredModel: model,
        resolvedModel: judgeCall.model,
        promptTokens: judgeCall.usage?.prompt_tokens ?? null,
        outputTokens: judgeCall.usage?.completion_tokens ?? null,
        thoughtsTokens: (judgeCall.usage as any)?.thoughts_tokens ?? null,
        totalTokens: judgeCall.usage?.total_tokens ?? null,
        maxTokens: 8192,
        finishReason: judgeCall.finish_reason,
        repairAttempts,
        durationMs: Date.now() - startTime,
      });`;

mp = mp.replace(searchMP, replaceMP);

const searchMP2 = `        policy_confidence: f.policy_confidence ?? null,
      }));
      
      return { passName: pass.name, findings: tagged, duration: Date.now() - startTime, model: pass.model, promptTokens: judgeCall.usage?.prompt_tokens ?? null, completionTokens: judgeCall.usage?.completion_tokens ?? null, totalTokens: judgeCall.usage?.total_tokens ?? null, promptCharacters: promptBase.length, completionCharacters: judgeCall.raw_judge_response.length, missingTitleCount: diagnostics.missing_title_count };
  } catch (error) {`;

const replaceMP2 = `        policy_confidence: f.policy_confidence ?? null,
      }));
      
      return { passName: pass.name, findings: tagged, duration: Date.now() - startTime, model: pass.model, promptTokens: judgeCall.usage?.prompt_tokens ?? null, completionTokens: judgeCall.usage?.completion_tokens ?? null, totalTokens: judgeCall.usage?.total_tokens ?? null, promptCharacters: promptBase.length, completionCharacters: judgeCall.raw_judge_response.length, missingTitleCount: diagnostics.missing_title_count };
    } catch (err: any) {
      logger.error("Judge Call Diagnostics (Failed)", {
        jobId: diagnosticContext?.jobId ?? null,
        chunkId: diagnosticContext?.chunkId ?? null,
        passName: pass.name,
        articleId: articleIds[0] ?? null,
        provider: config.AI_PROVIDER,
        configuredModel: model,
        resolvedModel: judgeCall?.model ?? (config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : model),
        promptTokens: err.usage?.prompt_tokens ?? judgeCall?.usage?.prompt_tokens ?? null,
        outputTokens: err.usage?.completion_tokens ?? judgeCall?.usage?.completion_tokens ?? null,
        thoughtsTokens: (err.usage as any)?.thoughts_tokens ?? (judgeCall?.usage as any)?.thoughts_tokens ?? null,
        totalTokens: err.usage?.total_tokens ?? judgeCall?.usage?.total_tokens ?? null,
        maxTokens: 8192,
        finishReason: err.finishReason ?? judgeCall?.finish_reason ?? null,
        repairAttempts,
        durationMs: Date.now() - startTime,
        error: err.message ?? String(err),
      });
      throw err;
    }
  } catch (error) {`;

mp = mp.replace(searchMP2, replaceMP2);

fs.writeFileSync('src/multiPassJudge.ts', mp);

let j = fs.readFileSync('src/jobs.ts', 'utf8');

const searchJ = `  const next = previous
    .catch(() => {})
    .then(async () => {
      const { error } = await operation();
      if (error) logger.warn(\`\${label} failed\`, { chunkId, err: error.message });
    });`;

const replaceJ = `  const next = previous
    .catch(() => {})
    .then(async () => {
      try {
        const { error } = (await operation()) || {};
        if (error) logger.warn(\`\${label} failed\`, { chunkId, err: error.message });
      } catch (err: any) {
        logger.error(\`\${label} threw an exception\`, {
          chunkId,
          errorName: err?.name,
          errorMessage: err?.message,
          errorCode: err?.code,
          causeName: err?.cause?.name,
          causeMessage: err?.cause?.message,
          causeCode: err?.cause?.code,
          causeErrno: err?.cause?.errno,
          causeSyscall: err?.cause?.syscall,
          targetUrl: config.SUPABASE_URL,
        });
      }
    });`;

j = j.replace(searchJ, replaceJ);

fs.writeFileSync('src/jobs.ts', j);
console.log('Patch complete!');
