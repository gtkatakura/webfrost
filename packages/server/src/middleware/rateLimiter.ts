// Sliding-window in-memory rate limiter. No external dependencies — pure Map
// of per-IP timestamp buckets, swept periodically so idle clients do not accumulate.
import { Elysia } from "elysia";

interface RateLimiterOptions {
  /** Maximum number of requests allowed in the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /**
   * HTTP methods this limiter applies to. When omitted the limiter applies to
   * all methods.
   */
  methods?: string[];
  /**
   * Only requests whose URL pathname matches are counted. When omitted the
   * limiter applies to every path it is mounted on.
   */
  path?: RegExp;
}

interface CheckResult {
  allowed: boolean;
  /** Seconds until the oldest request in the window expires. */
  retryAfterSec: number;
}

/** The subset of Bun's server the limiter needs to read the peer address. */
interface PeerLookup {
  requestIP(request: Request): { address: string } | null;
}

export interface RateLimiter {
  check(request: Request, server?: PeerLookup | null): CheckResult;
  /** Number of client buckets currently tracked (exposed for tests). */
  readonly size: number;
}

/** Sweep idle buckets after this many checks. */
const SWEEP_EVERY = 500;

/**
 * Identify the client for rate limiting.
 *
 * By default this is the TCP peer address: `X-Forwarded-For` is client-controlled
 * and trusting it would let anyone pick a fresh bucket per request. Set
 * WEBFROST_TRUST_PROXY=true only when the server sits behind a reverse proxy that
 * overwrites the header; the first entry is then used.
 */
export function getClientIp(request: Request, server?: PeerLookup | null): string {
  if (process.env.WEBFROST_TRUST_PROXY === "true") {
    const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  try {
    return server?.requestIP(request)?.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions): RateLimiter {
  // ip → sorted list of request timestamps inside the current window
  const windows = new Map<string, number[]>();
  let checksSinceSweep = 0;

  function sweep(cutoff: number): void {
    for (const [ip, timestamps] of windows) {
      const newest = timestamps[timestamps.length - 1];
      if (newest === undefined || newest <= cutoff) windows.delete(ip);
    }
  }

  return {
    get size() {
      return windows.size;
    },
    check(request: Request, server?: PeerLookup | null): CheckResult {
      const ip = getClientIp(request, server);
      const now = Date.now();
      const cutoff = now - windowMs;

      if (++checksSinceSweep >= SWEEP_EVERY) {
        checksSinceSweep = 0;
        sweep(cutoff);
      }

      const timestamps = windows.get(ip) ?? [];
      // Drop expired entries
      const recent = timestamps.filter((t) => t > cutoff);

      if (recent.length >= limit) {
        windows.set(ip, recent);
        const oldest = recent[0] ?? now;
        const retryAfterMs = oldest + windowMs - now;
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      recent.push(now);
      windows.set(ip, recent);
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

/**
 * Elysia plugin that enforces a sliding-window rate limit per client IP.
 *
 * When `methods` and/or `path` are supplied the check only fires for matching
 * requests, allowing different limits to coexist on the same app without
 * double-counting (e.g. a strict limit on login alongside a lenient read limit).
 *
 * The hook is registered globally, so mount the plugin once at the level whose
 * routes it should cover and use `path` to narrow it — not inside a sub-router.
 */
export function rateLimiterPlugin(options: RateLimiterOptions) {
  const limiter = createRateLimiter(options);
  const methods = options.methods ? new Set(options.methods) : null;
  const path = options.path ?? null;
  const scope = [options.methods?.join("+") ?? "any", path?.source ?? "any"].join(":");

  return new Elysia({
    name: `rate-limiter-${options.limit}-per-${options.windowMs}ms-${scope}`,
  }).onBeforeHandle({ as: "global" }, ({ request, set, server }) => {
    if (methods && !methods.has(request.method)) return;
    if (path && !path.test(new URL(request.url).pathname)) return;

    const result = limiter.check(request, server);
    if (!result.allowed) {
      set.status = 429;
      set.headers["retry-after"] = String(result.retryAfterSec);
      return { error: "rate limit exceeded" };
    }
    return;
  });
}
