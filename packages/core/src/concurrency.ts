/** Semaphore that limits how many async operations run at the same time. */
export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

/** Parse WEBFROST_CONCURRENCY env var, falling back to the given default. */
function parseConcurrency(defaultLimit: number): number {
  const raw = process.env.WEBFROST_CONCURRENCY;
  if (!raw) return defaultLimit;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : defaultLimit;
}

/** Create a ConcurrencyLimiter configured by WEBFROST_CONCURRENCY (default: 3). */
export function createConcurrencyLimiter(defaultLimit = 3): ConcurrencyLimiter {
  return new ConcurrencyLimiter(parseConcurrency(defaultLimit));
}
