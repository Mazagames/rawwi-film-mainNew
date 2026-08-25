import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-key";

const { ChunkExecutionController } = await import("./chunkExecutionController.js");
const { runReviewerPack } = await import("./noteDetection.js");
const { getNoteDefinitions } = await import("./notePromptPack.js");
const { AdaptiveReviewerScheduler } = await import("./reviewerLifecycle.js");

function getTestDefinitions() {
  return getNoteDefinitions().filter((definition) => definition.kind === "note" && /^article_(\d{2})_/.test(definition.id));
}

test("chunk soft deadline stops launching new reviewers while preserving in-flight work", async () => {
  const definitions = getTestDefinitions();
  const controller = new ChunkExecutionController({ softDeadlineMs: 20, hardDeadlineMs: 200, heartbeatMs: 1_000 });
  let started = 0;

  try {
    const result = await runReviewerPack(
      "chunk text",
      { events: [] } as any,
      { temperature: 0, seed: 1 },
      {
        jobId: "chunk-lifecycle-test",
        chunkId: "chunk-lifecycle-soft",
        signal: controller.signal,
        definitions,
        chunkController: controller,
        reviewerResponse: async (_definition, _signal) => {
          started += 1;
          if (started === 1) {
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          return '{"notes":[]}';
        },
      },
    );

    assert.equal(result.passResults.length, definitions.length);
    assert.ok(started < definitions.length, "new reviewer launches should stop after the soft deadline");
    assert.equal(controller.getState().softDeadlineReached, true);
  } finally {
    controller.dispose();
  }
});

test("chunk hard deadline aborts remaining reviewers and marks the chunk incomplete", async () => {
  const definitions = getTestDefinitions();
  const controller = new ChunkExecutionController({ softDeadlineMs: 20, hardDeadlineMs: 40, heartbeatMs: 1_000 });
  let started = 0;

  try {
    const result = await runReviewerPack(
      "chunk text",
      { events: [] } as any,
      { temperature: 0, seed: 1 },
      {
        jobId: "chunk-lifecycle-test",
        chunkId: "chunk-lifecycle-hard",
        signal: controller.signal,
        definitions,
        chunkController: controller,
        reviewerResponse: async (_definition, signal) => {
          started += 1;
          await new Promise((resolve) => setTimeout(resolve, 120));
          if (signal?.aborted) {
            throw new Error("aborted");
          }
          return '{"notes":[]}';
        },
      },
    );

    assert.equal(started > 0, true);
    assert.equal(controller.getState().hardDeadlineReached, true);
    assert.equal(controller.getState().chunkState, "hard_deadline");
    assert.equal(result.notes.length, 0);
  } finally {
    controller.dispose();
  }
});

test("transient reviewer failures drive chunk backpressure through the shared scheduler", async () => {
  const scheduler = new AdaptiveReviewerScheduler({ baseConcurrency: 3, minConcurrency: 1, recoveryDelayMs: 0, baseDelayMs: 1_000 });
  const controller = new ChunkExecutionController({ softDeadlineMs: 200, hardDeadlineMs: 500, heartbeatMs: 1_000 });
  controller.attachScheduler(scheduler);

  try {
    controller.noteProviderFailure({ status: 503, message: "service unavailable" });
    const state = controller.getState();

    assert.equal(state.providerHealth, "degraded");
    assert.equal(state.currentConcurrency, 2);
  } finally {
    controller.dispose();
  }
});

test("successful reviewer results remain available even when later reviewers fail", async () => {
  const definitions = getTestDefinitions();
  const controller = new ChunkExecutionController({ softDeadlineMs: 200, hardDeadlineMs: 500, heartbeatMs: 1_000 });
  let index = 0;

  try {
    const result = await runReviewerPack(
      "chunk text",
      { events: [] } as any,
      { temperature: 0, seed: 1 },
      {
        jobId: "chunk-lifecycle-test",
        chunkId: "chunk-lifecycle-persist",
        signal: controller.signal,
        definitions,
        chunkController: controller,
        reviewerResponse: async (definition) => {
          index += 1;
          if (definition.id === definitions[0].id) {
            return '{"notes":[{"reviewer":"' + definition.id + '","category":"' + definition.category + '","title":"ok","description":"ok","paragraph":"ok","quote":"ok","event_id":1,"confidence":0.8,"status":"new","included_in_report":true}]}';
          }
          if (index === 2) {
            throw new Error("simulated provider failure");
          }
          return '{"notes":[]}';
        },
      },
    );

    assert.ok(result.notes.length > 0, "successful reviewer output should be preserved");
    assert.equal(result.passResults.some((pass) => pass.status === "success"), true);
    assert.equal(result.passResults.some((pass) => pass.status === "provider_error"), true);
  } finally {
    controller.dispose();
  }
});
