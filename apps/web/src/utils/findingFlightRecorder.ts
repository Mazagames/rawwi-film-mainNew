export type FindingFlightRecorderSnapshot = {
  finding_uuid: string | null;
  article_id: number | null;
  title: string | null;
  event_id: number | null;
  chunk_index: number | null;
  page_number: number | null;
  quote: string | null;
  confidence: number | null;
};

export function logFindingFlightRecorderStage(args: {
  stage: string;
  reportId?: string | null;
  jobId?: string | null;
  findings: FindingFlightRecorderSnapshot[];
}): void {
  console.info("===== FINDING FLIGHT RECORDER =====", {
    stage: args.stage,
    reportId: args.reportId ?? null,
    jobId: args.jobId ?? null,
    findings: args.findings,
    total: args.findings.length,
  });
}
