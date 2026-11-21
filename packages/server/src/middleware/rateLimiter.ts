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

/** WEBFROST_TRUSTED_PROXY_HOPS: how many proxies in front of the server append to X-Forwarded-For. */
function trustedProxyHops(): number {
  const hops = Number(process.env.WEBFROST_TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/** Expand an IPv6 address to its eight hextets, or null when it is not one. */
function ipv6Hextets(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4) counts as two hextets.
  const last = tail.length > 0 ? tail : head;
  const lastPart = last[last.length - 1];
  if (lastPart?.includes(".")) {
    const octets = lastPart.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    last.splice(last.length - 1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const hextets = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...tail];
  if (!hextets.every((h) => /^[0-9a-f]{1,4}$/i.test(h))) return null;
  return hextets.map((h) => h.toLowerCase().replace(/^0+(?=.)/, ""));
}

/**
 * Bucket key for an address. One IPv6 host usually controls a whole /64, so IPv6
 * clients share a bucket per /64; IPv4-mapped IPv6 addresses count as IPv4.
 */
export function rateLimitKey(address: string): string {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!bare.includes(":")) return bare;
  const hextets = ipv6Hextets(bare);
  if (!hextets) return bare;
  if (hextets.slice(0, 5).every((h) => h === "0") && hextets[5] === "ffff") {
    const v4 = (hextets[6] ?? "0").padStart(4, "0") + (hextets[7] ?? "0").padStart(4, "0");
    return [0, 2, 4, 6].map((i) => Number.parseInt(v4.slice(i, i + 2), 16)).join(".");
  }
  return `${hextets.slice(0, 4).join(":")}::/64`;
}

/**
 * Identify the client for rate limiting.
 *
 * By default this is the TCP peer address: `X-Forwarded-For` is client-controlled
 * and trusting it would let anyone pick a fresh bucket per request. Set
 * WEBFROST_TRUST_PROXY=true only when the server sits behind a reverse proxy.
 * Proxies append the address they saw to whatever the client sent, so the client is
 * the entry WEBFROST_TRUSTED_PROXY_HOPS (default 1) places from the right — never
 * the left-most, which the client chooses.
 */
export function getClientIp(request: Request, server?: PeerLookup | null): string {
  if (process.env.WEBFROST_TRUST_PROXY === "true") {
    const entries = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const client = entries[Math.max(0, entries.length - trustedProxyHops())];
    if (client) return rateLimitKey(client);
  }
  try {
    const address = server?.requestIP(request)?.address;
    return address ? rateLimitKey(address) : "unknown";
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
