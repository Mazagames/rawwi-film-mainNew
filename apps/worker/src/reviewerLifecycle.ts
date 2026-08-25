export type ReviewerLifecycleEvent = {
  status?: number;
  message?: string;
  provider?: string;
};

export type ProviderHealthState = "healthy" | "degraded" | "unavailable" | "recovering";

export class AdaptiveReviewerScheduler {
  private currentConcurrency: number;
  private transientFailures: number;
  private lastTransientFailureAt: number | null;
  private recoveryStep: number;
  private providerHealth: ProviderHealthState;
  private readonly baseConcurrency: number;
  private readonly minConcurrency: number;
  private readonly recoveryDelayMs: number;
  private readonly baseDelayMs: number;

  constructor(options: { baseConcurrency: number; minConcurrency?: number; recoveryDelayMs?: number; baseDelayMs?: number }) {
    this.baseConcurrency = Math.max(1, options.baseConcurrency);
    this.minConcurrency = Math.max(1, options.minConcurrency ?? 1);
    this.recoveryDelayMs = Math.max(0, options.recoveryDelayMs ?? 5_000);
    this.baseDelayMs = Math.max(1_000, options.baseDelayMs ?? 5_000);
    this.currentConcurrency = this.baseConcurrency;
    this.transientFailures = 0;
    this.lastTransientFailureAt = null;
    this.recoveryStep = 0;
    this.providerHealth = "healthy";
  }

  getCurrentConcurrency(): number {
    return this.currentConcurrency;
  }

  getProviderHealthState(): ProviderHealthState {
    return this.providerHealth;
  }

  onTransientFailure(event: ReviewerLifecycleEvent): void {
    this.transientFailures += 1;
    this.lastTransientFailureAt = Date.now();
    if (this.currentConcurrency > this.minConcurrency) {
      this.currentConcurrency = Math.max(this.minConcurrency, this.currentConcurrency - 1);
    }
    if (this.transientFailures === 1) {
      this.providerHealth = "degraded";
    } else if (this.transientFailures >= 3) {
      this.providerHealth = "unavailable";
    }
  }

  onSuccess(): void {
    if (this.currentConcurrency >= this.baseConcurrency) {
      this.transientFailures = 0;
      this.recoveryStep = 0;
      this.providerHealth = "healthy";
      return;
    }
    this.recoveryStep += 1;
    this.transientFailures = Math.max(0, this.transientFailures - 1);
    this.currentConcurrency = Math.min(this.baseConcurrency, this.currentConcurrency + 1);
    this.providerHealth = this.currentConcurrency < this.baseConcurrency ? "recovering" : "healthy";
  }

  getNextRetryDelayMs(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** (attempt - 1), 60_000);
  }
}
