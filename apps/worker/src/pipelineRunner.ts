import type { AnalysisChunk, AnalysisJob } from "./jobs.js";
import { logger } from "./logger.js";
import { processChunkJudge as processChunkJudgeV1 } from "./pipeline.js";
import { processChunkJudge as processChunkJudgeV2 } from "./pipelineV2.js";

function getJobPipelineVersion(job: AnalysisJob): "v1" | "v2" {
  const pipelineVersion = (job.config_snapshot as { pipeline_version?: string } | null | undefined)?.pipeline_version;
  return pipelineVersion === "v2" ? "v2" : "v1";
}

export function resolvePipelineVersion(job: AnalysisJob): "v1" | "v2" {
  return getJobPipelineVersion(job);
}

export async function processChunkForJob(
  job: AnalysisJob,
  chunk: AnalysisChunk,
  normalizedText: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const pipelineVersion = resolvePipelineVersion(job);

  logger.info("Dispatching analysis pipeline", {
    jobId: job.id,
    chunkId: chunk.id,
    pipelineVersion,
  });

  if (pipelineVersion === "v2") {
    await processChunkJudgeV2(job, chunk, normalizedText, signal);
    return;
  }

  await processChunkJudgeV1(job, chunk, normalizedText, signal);
}
