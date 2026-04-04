// Sliding-window in-memory rate limiter. No external dependencies — pure Map
// of per-IP timestamp buckets, evicted eagerly on each request.
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
}

interface CheckResult {
  allowed: boolean;
  /** Seconds until the oldest request in the window expires. */
  retryAfterSec: number;
}

export interface RateLimiter {
  check(request: Request): CheckResult;
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions): RateLimiter {
  // ip → sorted list of request timestamps inside the current window
  const windows = new Map<string, number[]>();

  function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    return "unknown";
  }

  return {
    check(request: Request): CheckResult {
      const ip = getClientIp(request);
      const now = Date.now();
      const cutoff = now - windowMs;

      const timestamps = windows.get(ip) ?? [];
      // Drop expired entries
      const recent = timestamps.filter((t) => t > cutoff);

      if (recent.length >= limit) {
        windows.set(ip, recent);
        const oldest = recent[0] ?? now;
        const retryAfterMs = oldest + windowMs - now;
        return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
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
 * When `methods` is supplied the check only fires for those HTTP methods,
 * allowing different limits to coexist on the same router without double-
 * counting (e.g. a strict write limit on POST alongside a lenient read limit
 * on GET).
 */
export function rateLimiterPlugin(options: RateLimiterOptions) {
  const limiter = createRateLimiter(options);
  const methods = options.methods ? new Set(options.methods) : null;

  return new Elysia({
    name: `rate-limiter-${options.limit}-per-${options.windowMs}ms`,
  }).onBeforeHandle({ as: "global" }, ({ request, set }) => {
    if (methods && !methods.has(request.method)) return;

    const result = limiter.check(request);
    if (!result.allowed) {
      set.status = 429;
      set.headers["retry-after"] = String(result.retryAfterSec);
      return { error: "rate limit exceeded" };
    }
    return;
  });
}
