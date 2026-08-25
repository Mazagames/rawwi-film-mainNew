import { AdaptiveReviewerScheduler, type ProviderHealthState } from "./reviewerLifecycle.js";
import { logger } from "./logger.js";

export type ChunkLifecycleState = "idle" | "running" | "degraded" | "hard_deadline" | "cancelled" | "completed" | "incomplete";

export class ChunkExecutionController {
  private readonly softDeadlineMs: number;
  private readonly hardDeadlineMs: number;
  private readonly heartbeatMs: number;
  private readonly signalController: AbortController;
  private readonly scheduler?: AdaptiveReviewerScheduler;
  private readonly heartbeatTimer?: ReturnType<typeof setInterval>;
  private softDeadlineReached = false;
  private hardDeadlineReached = false;
  private chunkState: ChunkLifecycleState = "idle";
  private startedAt = Date.now();
  private lastHeartbeatAt = Date.now();
  private activeReviewerCount = 0;
  private completedReviewerCount = 0;
  private failedReviewerCount = 0;
  private totalReviewerCount = 0;
  private providerHealth: ProviderHealthState = "healthy";
  private currentConcurrency = 1;

  constructor(options: { softDeadlineMs: number; hardDeadlineMs: number; heartbeatMs: number }) {
    this.softDeadlineMs = Math.max(1, options.softDeadlineMs);
    this.hardDeadlineMs = Math.max(this.softDeadlineMs + 1, options.hardDeadlineMs);
    this.heartbeatMs = Math.max(1, options.heartbeatMs);
    this.signalController = new AbortController();
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), this.heartbeatMs);
  }

  get signal(): AbortSignal {
    return this.signalController.signal;
  }

  attachScheduler(scheduler: AdaptiveReviewerScheduler): void {
    this.scheduler = scheduler;
    this.currentConcurrency = scheduler.getCurrentConcurrency();
    this.providerHealth = scheduler.getProviderHealthState();
  }

  start(): void {
    this.chunkState = "running";
    this.startedAt = Date.now();
  }

  getState() {
    return {
      chunkState: this.chunkState,
      softDeadlineReached: this.softDeadlineReached,
      hardDeadlineReached: this.hardDeadlineReached,
      providerHealth: this.providerHealth,
      currentConcurrency: this.currentConcurrency,
      activeReviewerCount: this.activeReviewerCount,
      completedReviewerCount: this.completedReviewerCount,
      failedReviewerCount: this.failedReviewerCount,
      totalReviewerCount: this.totalReviewerCount,
    };
  }

  markReviewerStarted(): void {
    this.activeReviewerCount += 1;
    this.totalReviewerCount += 1;
  }

  markReviewerCompleted(): void {
    this.activeReviewerCount = Math.max(0, this.activeReviewerCount - 1);
    this.completedReviewerCount += 1;
    this.updateSchedulerFromSuccess();
    this.updateChunkStateFromProgress();
  }

  markReviewerFailed(): void {
    this.activeReviewerCount = Math.max(0, this.activeReviewerCount - 1);
    this.failedReviewerCount += 1;
    this.updateChunkStateFromProgress();
  }

  markReviewerAborted(): void {
    this.activeReviewerCount = Math.max(0, this.activeReviewerCount - 1);
  }

  shouldLaunchNewReviewers(): boolean {
    if (this.hardDeadlineReached || this.signalController.signal.aborted) return false;
    if (this.softDeadlineReached) return false;
    return true;
  }

  noteProviderFailure(error: unknown): void {
    if (this.scheduler) {
      this.scheduler.onTransientFailure({ status: 503, message: error instanceof Error ? error.message : String(error) });
      this.providerHealth = this.scheduler.getProviderHealthState();
      this.currentConcurrency = this.scheduler.getCurrentConcurrency();
    }
    if (this.providerHealth !== "healthy") {
      this.chunkState = "degraded";
    }
  }

  noteProviderSuccess(): void {
    this.updateSchedulerFromSuccess();
  }

  private updateSchedulerFromSuccess(): void {
    if (this.scheduler) {
      this.scheduler.onSuccess();
      this.providerHealth = this.scheduler.getProviderHealthState();
      this.currentConcurrency = this.scheduler.getCurrentConcurrency();
    }
  }

  private updateChunkStateFromProgress(): void {
    if (this.hardDeadlineReached) {
      this.chunkState = "hard_deadline";
      return;
    }
    if (this.softDeadlineReached) {
      this.chunkState = "degraded";
      return;
    }
    if (this.activeReviewerCount === 0 && this.totalReviewerCount > 0) {
      this.chunkState = this.failedReviewerCount > 0 ? "incomplete" : "completed";
    }
  }

  tick(): void {
    const age = Date.now() - this.startedAt;
    if (age >= this.hardDeadlineMs) {
      this.hardDeadlineReached = true;
      this.chunkState = "hard_deadline";
      this.signalController.abort(new Error("chunk hard deadline"));
      return;
    }
    if (age >= this.softDeadlineMs && !this.softDeadlineReached) {
      this.softDeadlineReached = true;
      this.chunkState = "degraded";
      this.providerHealth = "degraded";
      this.currentConcurrency = Math.max(1, this.currentConcurrency - 1);
    }
  }

  cancel(): void {
    this.chunkState = "cancelled";
    this.signalController.abort(new Error("Analysis stopped."));
  }

  emitHeartbeat(): void {
    this.lastHeartbeatAt = Date.now();
    if (this.signalController.signal.aborted) {
      return;
    }
    this.tick();
    logger.info("Chunk lifecycle heartbeat", {
      chunkState: this.chunkState,
      softDeadlineReached: this.softDeadlineReached,
      hardDeadlineReached: this.hardDeadlineReached,
      providerHealth: this.providerHealth,
      currentConcurrency: this.currentConcurrency,
      activeReviewerCount: this.activeReviewerCount,
      completedReviewerCount: this.completedReviewerCount,
      failedReviewerCount: this.failedReviewerCount,
      totalReviewerCount: this.totalReviewerCount,
    });
  }

  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }
}
