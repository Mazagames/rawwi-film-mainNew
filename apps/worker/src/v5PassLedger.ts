import { supabase } from "./db.js";
import { logger } from "./logger.js";

export type V5PassLedgerStatus = "running" | "completed" | "failed";

type V5PassLedgerKey = {
  jobId: string;
  chunkId: string;
  passName: string;
};

export type V5PassLedgerStart = V5PassLedgerKey & {
  provider: string;
  model: string;
};

export type V5PassLedgerUpdate = V5PassLedgerKey & {
  status: Exclude<V5PassLedgerStatus, "running">;
  rawResponseLength?: number | null;
  parsedFindingsCount?: number | null;
  earlyFilterInputCount?: number | null;
  earlyFilterOutputCount?: number | null;
  errorMessage?: string | null;
};

function keyFilter(query: any, key: V5PassLedgerKey): any {
  return query.eq("job_id", key.jobId).eq("chunk_id", key.chunkId).eq("pass_name", key.passName);
}

export async function persistV5PassStart(args: V5PassLedgerStart): Promise<void> {
  logger.info("V5 reviewer request started", args);
  try {
    const { error } = await supabase.from("analysis_v5_pass_ledger").upsert(
      {
        job_id: args.jobId,
        chunk_id: args.chunkId,
        pass_name: args.passName,
        provider: args.provider,
        model: args.model,
        status: "running",
        request_started_at: new Date().toISOString(),
        request_completed_at: null,
        raw_response_length: null,
        parsed_findings_count: null,
        early_filter_input_count: null,
        early_filter_output_count: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,chunk_id,pass_name" },
    );
    if (error) {
      logger.warn("V5 pass ledger start persistence failed", {
        ...args,
        error: error.message,
      });
    }
  } catch (error) {
    logger.warn("V5 pass ledger start persistence failed", {
      ...args,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateV5PassLedger(args: V5PassLedgerUpdate): Promise<void> {
  logger.info(args.status === "completed" ? "V5 reviewer request completed" : "V5 reviewer request failed", args);
  try {
    const update: Record<string, unknown> = {
      status: args.status,
      updated_at: new Date().toISOString(),
    };
    if (args.status !== "completed" || args.rawResponseLength !== undefined || args.parsedFindingsCount !== undefined) {
      update.request_completed_at = new Date().toISOString();
    }
    if (args.rawResponseLength !== undefined) update.raw_response_length = args.rawResponseLength;
    if (args.parsedFindingsCount !== undefined) update.parsed_findings_count = args.parsedFindingsCount;
    if (args.earlyFilterInputCount !== undefined) update.early_filter_input_count = args.earlyFilterInputCount;
    if (args.earlyFilterOutputCount !== undefined) update.early_filter_output_count = args.earlyFilterOutputCount;
    if (args.errorMessage !== undefined) update.error_message = args.errorMessage;
    const { error } = await keyFilter(
      supabase.from("analysis_v5_pass_ledger").update(update),
      args,
    );
    if (error) {
      logger.warn("V5 pass ledger update failed", {
        ...args,
        error: error.message,
      });
    }
  } catch (error) {
    logger.warn("V5 pass ledger update failed", {
      ...args,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
