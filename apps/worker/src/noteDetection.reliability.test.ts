import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const { getNoteDefinitions } = await import("./notePromptPack.js");
const { runReviewerPack } = await import("./noteDetection.js");

test("one reviewer error does not block the remaining Article reviewers", async () => {
  const definitions = getNoteDefinitions();
  const result = await runReviewerPack(
    "test chunk",
    { events: [] } as any,
    { temperature: 0, seed: 12345 },
    {
      jobId: "reliability-test-job",
      chunkId: "reliability-test-chunk",
      definitions,
      reviewerResponse: async (definition) => {
        if (definition.id === "article_11_media_credibility") {
          throw new Error("simulated provider failure");
        }
        return '{"notes":[]}';
      },
    },
  );

  assert.equal(result.passResults.length, definitions.length);
  assert.equal(result.passResults.filter((pass) => pass.status === "provider_error").length, 1);
  assert.equal(result.passResults.filter((pass) => pass.status === "empty").length, definitions.length - 1);
  assert.equal(result.passResults.every((pass) => pass.status), true);
});
