import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Initialize providers lazily to pick up config overrides in tests
let openai: OpenAI | null = null;
let gemini: GoogleGenAI | null = null;

export function isActiveAIProviderConfigured(): boolean {
  if (config.AI_PROVIDER === "gemini") return !!config.GEMINI_API_KEY;
  return !!config.OPENAI_API_KEY;
}

export interface AICompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  seed?: number; // Only respected by OpenAI natively
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  thinkingBudget?: number;
}

export interface AICompletionResponse {
  content: string;
  finishReason: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    thoughts_tokens?: number;
  } | null;
  responseId: string | null;
  responseTimestamp: string;
}

async function generateOpenAICompletion(req: AICompletionRequest): Promise<AICompletionResponse> {
  if (!openai) {
    if (!config.OPENAI_API_KEY) throw new Error("OpenAI API key not configured");
    openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  const response = await openai.chat.completions.create(
    {
      model: req.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: req.temperature,
      seed: req.seed,
      max_tokens: req.maxTokens,
    },
    { timeout: req.timeoutMs ?? config.JUDGE_TIMEOUT_MS, signal: req.signal }
  );

  return {
    content: response.choices[0]?.message?.content ?? "{}",
    finishReason: response.choices[0]?.finish_reason ?? null,
    usage: response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : null,
    responseId: response.id ?? null,
    responseTimestamp: new Date().toISOString(),
  };
}

async function generateGeminiCompletion(req: AICompletionRequest): Promise<AICompletionResponse> {
  if (!gemini) {
    if (!config.GEMINI_API_KEY) throw new Error("Gemini API key not configured");
    gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  }

  const response = await gemini.models.generateContent({
    model: req.model,
    contents: req.userPrompt,
    config: {
      systemInstruction: req.systemPrompt,
      responseMimeType: "application/json",
      temperature: req.temperature ?? 0,
      maxOutputTokens: req.maxTokens,
      ...(req.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: req.thinkingBudget } } : {}),
    },
  });

  // Gemini SDK @google/genai maps usage differently
  const usageMetadata = response.usageMetadata;
  const usage = usageMetadata
    ? {
        prompt_tokens: usageMetadata.promptTokenCount ?? 0,
        completion_tokens: usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: usageMetadata.totalTokenCount ?? 0,
        thoughts_tokens: (usageMetadata as any).thoughtsTokenCount,
      }
    : null;

  // Gemini's finish reason might be mapped to 'STOP' or similar
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;

  const finishReasonStr = typeof finishReason === "string" ? finishReason.toLowerCase() : null;

  if (!response.text && finishReasonStr === "max_tokens") {
    const err = new Error("AI provider returned MAX_TOKENS with no text. The generated response exceeded the configured maxTokens limit.");
    (err as any).finishReason = finishReasonStr;
    (err as any).usage = usage;
    throw err;
  }

  return {
    content: response.text ?? "{}",
    finishReason: finishReasonStr,
    usage,
    // Gemini SDK usually returns no top-level responseId in this interface, we fallback to null
    responseId: null,
    responseTimestamp: new Date().toISOString(),
  };
}

export async function generateStructuredCompletion(req: AICompletionRequest): Promise<AICompletionResponse> {
  if (config.AI_PROVIDER === "gemini") {
    // The @google/genai SDK (v2.17.1) does not natively support AbortSignal or timeout.
    // We intentionally avoid Promise.race here because it would only reject the caller
    // while leaving the underlying network request running, which violates the
    // requirement to reliably cancel the actual request.
    return generateGeminiCompletion(req);
  }

  return generateOpenAICompletion(req);
}
