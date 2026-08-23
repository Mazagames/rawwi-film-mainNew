import { test, expect, describe, vi } from 'vitest';
vi.mock('./db.js', () => ({ supabase: {} }));
vi.mock('./executionSignature.js', () => ({ persistAnalysisExecutionSignature: vi.fn() }));
import { runMultiPassDetection } from './multiPassJudge.js';
import * as openai from './openai.js';

describe('V5 article_id injection in multiPassJudge', () => {
  test('injects article_id from pass when missing/0', async () => {
    const mockArticles = [{
      id: 17,
      title_ar: "الكرامة والسمعة والخصوصية",
      text_ar: "يمنع التشهير",
      atoms: []
    }];

    const mockPlan = {
      planVersion: "1.0",
      activePasses: [{
        name: "v5_article_17",
        articleIds: [17],
        buildPrompt: () => "mock_prompt",
        model: "gemini-2.5-pro",
        sourceFileName: "article_17.md"
      }],
      skippedPasses: []
    };

    const mockJobConfig = {
      judge_model: 'gemini-2.5-pro',
      temperature: 0,
      seed: 42
    };

    // Spy on callJudgeRaw to just return a dummy response to skip network
    vi.spyOn(openai, 'callJudgeRaw').mockResolvedValue({
        raw_judge_response: "mocked",
        prompt_hash: "hash",
        rendered_system_prompt: "",
        rendered_user_prompt: "",
        model: "gemini-2.5-pro",
        finish_reason: "stop",
        usage: null,
        response_id: "1",
        response_timestamp: "now"
    } as any);

    // Spy on parseJudgeWithRepair to return finding with article_id: 0
    vi.spyOn(openai, 'parseJudgeWithRepair').mockResolvedValue({
        findings: [{
            article_id: 0,
            canonical_atom: "PRIVACY",
            confidence: 1,
            title_ar: "Test Title",
            evidence_snippet: "Test snippet",
            intensity: 4,
            context_impact: 4,
            legal_sensitivity: 4,
            audience_risk: 4,
            is_interpretive: false,
            location: { start_offset: 0, end_offset: 10 }
        } as any],
        diagnostics: {} as any
    });

    const res = await runMultiPassDetection(
      "test chunk",
      0,
      10,
      mockArticles as any,
      [],
      mockJobConfig as any,
      undefined,
      mockPlan as any
    );

    expect(res.findings.length).toBe(1);
    expect(res.findings[0].article_id).toBe(17);
    expect(res.findings[0].detection_pass).toBe("v5_article_17");
  });

  test('does not overwrite explicitly supplied valid article_id', async () => {
    const mockArticles = [{
      id: 17,
      title_ar: "الكرامة",
      text_ar: "الكرامة",
      atoms: []
    }];

    const mockPlan = {
      planVersion: "1.0",
      activePasses: [{
        name: "v5_article_17",
        articleIds: [17],
        buildPrompt: () => "mock_prompt",
        model: "gemini-2.5-pro",
        sourceFileName: "article_17.md"
      }],
      skippedPasses: []
    };

    const mockJobConfig = {
      judge_model: 'gemini-2.5-pro',
      temperature: 0,
      seed: 42
    };

    vi.spyOn(openai, 'callJudgeRaw').mockResolvedValue({
        raw_judge_response: "mocked",
        prompt_hash: "hash",
        rendered_system_prompt: "",
        rendered_user_prompt: "",
        model: "gemini-2.5-pro",
        finish_reason: "stop",
        usage: null,
        response_id: "1",
        response_timestamp: "now"
    } as any);

    vi.spyOn(openai, 'parseJudgeWithRepair').mockResolvedValue({
        findings: [{
            article_id: 14, // Model returned 14 explicitly for some reason
            canonical_atom: "INSULT",
            confidence: 1,
            title_ar: "Test Title",
            evidence_snippet: "Test snippet",
            intensity: 4,
            context_impact: 4,
            legal_sensitivity: 4,
            audience_risk: 4,
            is_interpretive: false,
            location: { start_offset: 0, end_offset: 10 }
        } as any],
        diagnostics: {} as any
    });

    const res = await runMultiPassDetection(
      "test chunk",
      0,
      10,
      mockArticles as any,
      [],
      mockJobConfig as any,
      undefined,
      mockPlan as any
    );

    expect(res.findings.length).toBe(1);
    expect(res.findings[0].article_id).toBe(14); // Remains 14
  });
});
