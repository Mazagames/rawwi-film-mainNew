import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { config, getAIProviderPolicy, resolveAIProvider, type AIProvider } from "./config.js";
import { logger } from "./logger.js";

// Initialize providers lazily to pick up config overrides in tests
let openai: OpenAI | null = null;
let gemini: GoogleGenAI | null = null;
let geminiTimeoutMs: number | null = null;

export type ProviderFailureKind = "no_credits" | "model_not_found" | "auth_error" | "rate_limited" | "timeout" | "provider_busy" | "config_error" | "provider_error";

export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  const candidate = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown } | null;
  if (candidate && typeof (candidate as { providerFailure?: unknown }).providerFailure === "string") {
    return (candidate as { providerFailure: ProviderFailureKind }).providerFailure;
  }
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  if (/no credits|insufficient[_\s-]?quota|quota exceeded|billing|payment required|credit/i.test(message)) return "no_credits";
  if (candidate?.status === 404 || /model.*not found|not available|unsupported model/i.test(message)) return "model_not_found";
  if (candidate?.status === 401 || candidate?.status === 403 || /api key|unauthorized|authentication/i.test(message)) return "auth_error";
  if (candidate?.name === "ProviderTimeoutError" || /timed out|timeout/i.test(message)) return "timeout";
  if (candidate?.status === 429 || candidate?.code === 429 || /rate.?limit|too many requests/i.test(message)) return "rate_limited";
  if (candidate?.name === "ProviderPolicyError" || /not configured|invalid request|invalid model|configuration/i.test(message)) return "config_error";
  if (candidate?.status === 503 || /overloaded|service unavailable|temporarily unavailable/i.test(message)) return "provider_busy";
  return "provider_error";
}

class ProviderTimeoutError extends Error {
  constructor(provider: "openai" | "gemini", timeoutMs: number) {
    super(`${provider} request timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

function withProviderTimeout<T>(
  provider: "openai" | "gemini",
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const cancellation = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(provider, timeoutMs)), timeoutMs);
    abortHandler = () => reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([operation, cancellation]).finally(() => {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  });
}

export function isActiveAIProviderConfigured(): boolean {
  if (resolveAIProvider(config.AI_PROVIDER) === "gemini") return !!config.GEMINI_API_KEY;
  return !!config.OPENAI_API_KEY;
}

export interface AICompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  seed?: number; // Only respected by OpenAI natively
  maxTokens?: number;
  thinkingBudget?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  providerOverride?: "openai" | "gemini";
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
    openai = new OpenAI({ apiKey: config.OPENAI_API_KEY, fetch: globalThis.fetch as any });
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
  const timeoutMs = req.timeoutMs ?? config.JUDGE_TIMEOUT_MS;
  if (!gemini || geminiTimeoutMs !== timeoutMs) {
    if (!config.GEMINI_API_KEY) throw new Error("Gemini API key not configured");
    gemini = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY, httpOptions: { timeout: timeoutMs } });
    geminiTimeoutMs = timeoutMs;
  }

  const operation = gemini.models.generateContent({
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
  const response = await withProviderTimeout("gemini", operation, timeoutMs, req.signal);

  // Gemini SDK @google/genai maps usage differently
  const usageMetadata = response.usageMetadata;
  const usage = usageMetadata
    ? {
        prompt_tokens: usageMetadata.promptTokenCount ?? 0,
        completion_tokens: usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: usageMetadata.totalTokenCount ?? 0,
        ...((usageMetadata as any).thoughtsTokenCount !== undefined
          ? { thoughts_tokens: (usageMetadata as any).thoughtsTokenCount }
          : {}),
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
  const requestedProvider = (req.providerOverride ?? config.AI_PROVIDER) as AIProvider;
  const policy = getAIProviderPolicy();
  const provider = resolveAIProvider(requestedProvider);
  if (requestedProvider !== provider && !policy.fallbackAllowed) {
    const error = new Error(`Provider ${requestedProvider} is disabled by ${policy.mode} mode`);
    error.name = "ProviderPolicyError";
    throw error;
  }
  if (provider === "gemini") {
    return generateGeminiCompletion(req);
  }

  return generateOpenAICompletion(req);
}
