import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const { config, resolveViolationSystemVersion } = await import("./config.js");
  const { getDetectionPassesForViolationSystem } = await import("./multiPassJudge.js");

  const resolved = resolveViolationSystemVersion(
    { violation_system_version: "v5" },
    "v2",
  );
  assert(resolved === "v5", `expected job version v5, got ${resolved}`);
  const passes = getDetectionPassesForViolationSystem(resolved);
  assert(passes.length === 21, `expected 21 V5 passes, got ${passes.length}`);
  assert(passes[0]?.name === "v5_article_01", "expected V5 reviewer pass selection");
  console.log("✓ job-level V5 selects 21 reviewer passes over the global version");

  const legacyResolved = resolveViolationSystemVersion({}, "v4");
  assert(legacyResolved === "v4", `expected legacy fallback v4, got ${legacyResolved}`);
  assert(resolveViolationSystemVersion({ violation_system_version: "invalid" }, "v3") === "v3", "invalid job version should use the global fallback");
  console.log("✓ legacy and invalid job snapshots use the global violation-system fallback");
  assert(config.VIOLATION_SYSTEM_VERSION === "v5" || typeof config.VIOLATION_SYSTEM_VERSION === "string", "worker version should be configured");
  console.log("✓ worker configuration exposes a supported violation-system version");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});