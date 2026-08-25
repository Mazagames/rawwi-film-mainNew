import assert from "node:assert/strict";
import test from "node:test";

const geminiEnvKeys = [
  "GEMINI_ROUTER_MODEL",
  "GEMINI_JUDGE_MODEL",
  "GEMINI_AUDITOR_MODEL",
  "GEMINI_RATIONALE_MODEL",
] as const;

function snapshotGeminiEnv() {
  return Object.fromEntries(geminiEnvKeys.map((key) => [key, process.env[key]]));
}

function restoreGeminiEnv(snapshot: Record<string, string | undefined>) {
  for (const key of geminiEnvKeys) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("gemini role defaults fall back to flash when gemini env vars are absent", async () => {
  const snapshot = snapshotGeminiEnv();
  const originalProvider = process.env.AI_PROVIDER;
  const originalProviderMode = process.env.AI_PROVIDER_MODE;
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_PROVIDER_MODE = "gemini-only";
  for (const key of geminiEnvKeys) {
    delete process.env[key];
  }

  try {
    const { config: runtimeConfig, resolveModelForRole } = await import("./config.js?gemini-defaults");
    assert.equal(runtimeConfig.V5_VIOLATION_JUDGE_MODEL, "gemini-2.5-flash");
    assert.equal(runtimeConfig.V5_VIOLATION_JUDGE_PROVIDER, "gemini");
    assert.deepStrictEqual(
      {
        router: resolveModelForRole("router", "").model,
        judge: resolveModelForRole("judge", "").model,
        auditor: resolveModelForRole("auditor", "").model,
        rationale: resolveModelForRole("rationale", "").model,
      },
      {
        router: "gemini-2.5-flash",
        judge: "gemini-2.5-flash",
        auditor: "gemini-2.5-flash",
        rationale: "gemini-2.5-flash",
      },
    );
  } finally {
    restoreGeminiEnv(snapshot);
    if (originalProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = originalProvider;
    if (originalProviderMode === undefined) delete process.env.AI_PROVIDER_MODE; else process.env.AI_PROVIDER_MODE = originalProviderMode;
  }
});

test("explicit gemini env values override the defaults", async () => {
  const snapshot = snapshotGeminiEnv();
  const originalProvider = process.env.AI_PROVIDER;
  const originalProviderMode = process.env.AI_PROVIDER_MODE;
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_PROVIDER_MODE = "gemini-only";
  process.env.GEMINI_ROUTER_MODEL = "gemini-override-router";
  process.env.GEMINI_JUDGE_MODEL = "gemini-override-judge";
  process.env.GEMINI_AUDITOR_MODEL = "gemini-override-auditor";
  process.env.GEMINI_RATIONALE_MODEL = "gemini-override-rationale";

  try {
    const { resolveModelForRole } = await import("./config.js?gemini-overrides");
    assert.deepStrictEqual(
      {
        router: resolveModelForRole("router", "").model,
        judge: resolveModelForRole("judge", "").model,
        auditor: resolveModelForRole("auditor", "").model,
        rationale: resolveModelForRole("rationale", "").model,
      },
      {
        router: "gemini-override-router",
        judge: "gemini-override-judge",
        auditor: "gemini-override-auditor",
        rationale: "gemini-override-rationale",
      },
    );
  } finally {
    restoreGeminiEnv(snapshot);
  }
});
