import { envInt } from "./ssrf-guard";

const DEFAULT_DOMAIN_DELAY_MS = 1000;
const MAX_TRACKED_HOSTS = 2000;

/**
 * Per-host politeness throttle: spaces out pipeline runs that target the same
 * hostname so a bulk import or a busy feed never hammers one origin.
 *
 * Each call to `wait(host)` reserves the next free slot for that host and
 * resolves when the slot arrives. Different hosts never wait on each other.
 */
export class HostThrottle {
  private readonly nextSlot = new Map<string, number>();

  /** @param delayMs minimum gap between two runs for the same host; a function is re-read on every call. */
  constructor(private readonly delayMs: number | (() => number)) {}

  async wait(host: string): Promise<void> {
    const delay = typeof this.delayMs === "function" ? this.delayMs() : this.delayMs;
    if (delay <= 0) return;

    const key = host.toLowerCase();
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(key) ?? 0);
    this.nextSlot.set(key, slot + delay);

    if (this.nextSlot.size > MAX_TRACKED_HOSTS) {
      for (const [h, t] of this.nextSlot) {
        if (t <= now) this.nextSlot.delete(h);
      }
    }

    if (slot > now) await Bun.sleep(slot - now);
  }
}

/**
 * Process-wide throttle used by the pipeline.
 * Configured by WEBFROST_DOMAIN_DELAY_MS (default 1000 ms; 0 disables it).
 */
export const domainThrottle = new HostThrottle(() =>
  envInt("WEBFROST_DOMAIN_DELAY_MS", DEFAULT_DOMAIN_DELAY_MS),
);
