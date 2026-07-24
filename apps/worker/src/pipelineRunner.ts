import type { AnalysisChunk, AnalysisJob } from "./jobs.js";
import { logger } from "./logger.js";
import { processChunkJudge as processChunkJudgeV1 } from "./pipeline.js";

export function resolvePipelineVersion(_job: AnalysisJob): "v1" {
  return "v1";
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

  await processChunkJudgeV1(job, chunk, normalizedText, signal);
}
