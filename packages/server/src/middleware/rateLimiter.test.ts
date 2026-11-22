import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { createRateLimiter, getClientIp, rateLimiterPlugin } from "./rateLimiter";

// Most tests below tell clients apart with X-Forwarded-For, which is only honoured
// behind a trusted proxy. The "client identity" block covers the default.
beforeAll(() => {
  process.env.WEBFROST_TRUST_PROXY = "true";
});

afterAll(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_TRUST_PROXY");
});

function makeRequest(ip: string, method = "GET", path = "/"): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

describe("createRateLimiter", () => {
  it("allows requests below the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check(makeRequest("1.2.3.4")).allowed).toBe(true);
    }
  });

  it("blocks requests at the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) limiter.check(makeRequest("1.2.3.4"));
    const result = limiter.check(makeRequest("1.2.3.4"));
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks IPs independently", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.check(makeRequest("10.0.0.1"));
    limiter.check(makeRequest("10.0.0.1"));
    // 10.0.0.1 is exhausted, but 10.0.0.2 has not been seen
    expect(limiter.check(makeRequest("10.0.0.1")).allowed).toBe(false);
    expect(limiter.check(makeRequest("10.0.0.2")).allowed).toBe(true);
  });

  it("uses the right-most IP of the x-forwarded-for chain", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const req = (xff: string) =>
      new Request("http://localhost/", { headers: { "x-forwarded-for": xff } });
    expect(limiter.check(req("5.6.7.8, 9.10.11.12")).allowed).toBe(true);
    // A client rotating the entry it controls (the left one) stays in its bucket.
    expect(limiter.check(req("1.1.1.1, 9.10.11.12")).allowed).toBe(false);
    expect(limiter.check(req("9.10.11.12")).allowed).toBe(false);
    expect(limiter.check(req("5.6.7.8")).allowed).toBe(true);
  });

  it("falls back to 'unknown' when no IP header present", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const req1 = new Request("http://localhost/");
    const req2 = new Request("http://localhost/");
    expect(limiter.check(req1).allowed).toBe(true);
    expect(limiter.check(req2).allowed).toBe(false);
  });
});

describe("rateLimiterPlugin", () => {
  it("returns 429 after the limit is exceeded", async () => {
    const app = new Elysia()
      .use(rateLimiterPlugin({ limit: 2, windowMs: 60_000 }))
      .get("/", () => ({ ok: true }));

    const ip = "42.0.0.1";
    const ok1 = await app.handle(makeRequest(ip));
    const ok2 = await app.handle(makeRequest(ip));
    const blocked = await app.handle(makeRequest(ip));

    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = await blocked.json();
    expect(body).toEqual({ error: "rate limit exceeded", code: "RATE_LIMITED" });
  });

  it("only applies to specified methods", async () => {
    const app = new Elysia()
      .use(rateLimiterPlugin({ limit: 1, windowMs: 60_000, methods: ["POST"] }))
      .get("/", () => ({ ok: true }))
      .post("/", () => ({ ok: true }));

    const ip = "42.0.0.2";
    // GET requests are unlimited
    for (let i = 0; i < 5; i++) {
      const res = await app.handle(makeRequest(ip, "GET"));
      expect(res.status).toBe(200);
    }
    // First POST is allowed, second is blocked
    const post1 = await app.handle(makeRequest(ip, "POST"));
    expect(post1.status).toBe(200);
    const post2 = await app.handle(makeRequest(ip, "POST"));
    expect(post2.status).toBe(429);
  });
});

describe("client identity", () => {
  const peer = (address: string) => ({ requestIP: () => ({ address }) });

  it("ignores X-Forwarded-For unless a proxy is trusted", () => {
    Reflect.deleteProperty(process.env, "WEBFROST_TRUST_PROXY");
    try {
      const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
      // Same TCP peer, a different spoofed header on every request: still one bucket.
      expect(limiter.check(makeRequest("1.1.1.1"), peer("203.0.113.7")).allowed).toBe(true);
      expect(limiter.check(makeRequest("2.2.2.2"), peer("203.0.113.7")).allowed).toBe(false);
      // A different peer gets its own bucket.
      expect(limiter.check(makeRequest("1.1.1.1"), peer("203.0.113.8")).allowed).toBe(true);
    } finally {
      process.env.WEBFROST_TRUST_PROXY = "true";
    }
  });

  it("uses the socket address when there is no forwarded header", () => {
    expect(getClientIp(new Request("http://localhost/"), peer("198.51.100.4"))).toBe(
      "198.51.100.4",
    );
  });

  it("uses the forwarded address behind a trusted proxy", () => {
    expect(getClientIp(makeRequest("9.9.9.9"), peer("10.0.0.1"))).toBe("9.9.9.9");
  });

  it("ignores spoofed left-most X-Forwarded-For entries", () => {
    expect(getClientIp(makeRequest("6.6.6.6, 9.9.9.9"), peer("10.0.0.1"))).toBe("9.9.9.9");
  });

  it("skips WEBFROST_TRUSTED_PROXY_HOPS entries from the right", () => {
    process.env.WEBFROST_TRUSTED_PROXY_HOPS = "2";
    try {
      // client-supplied, real client (added by the CDN), CDN (added by nginx)
      const req = makeRequest("6.6.6.6, 9.9.9.9, 172.16.0.5");
      expect(getClientIp(req, peer("10.0.0.1"))).toBe("9.9.9.9");
      // Fewer entries than hops: take the left-most there is.
      expect(getClientIp(makeRequest("9.9.9.9"), peer("10.0.0.1"))).toBe("9.9.9.9");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_TRUSTED_PROXY_HOPS");
    }
  });

  it("buckets IPv6 clients by /64", () => {
    expect(getClientIp(new Request("http://localhost/"), peer("2001:db8:1:2:aaaa::1"))).toBe(
      "2001:db8:1:2::/64",
    );
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check(makeRequest("2001:db8:1:2::1")).allowed).toBe(true);
    // Same /64, different interface id: same bucket.
    expect(limiter.check(makeRequest("2001:0db8:0001:0002:ffff:1:2:3")).allowed).toBe(false);
    // Another /64 gets its own.
    expect(limiter.check(makeRequest("2001:db8:1:3::1")).allowed).toBe(true);
  });

  it("treats IPv4-mapped IPv6 peers as IPv4", () => {
    expect(getClientIp(new Request("http://localhost/"), peer("::ffff:192.0.2.9"))).toBe(
      "192.0.2.9",
    );
    expect(getClientIp(new Request("http://localhost/"), peer("::1"))).toBe("0:0:0:0::/64");
  });

  it("forgets clients once their window has passed", async () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 20 });
    for (let i = 0; i < 400; i++) limiter.check(makeRequest(`10.1.${i >> 8}.${i & 255}`));
    expect(limiter.size).toBe(400);
    await Bun.sleep(40);
    // The sweep runs every 500 checks; these push it over the threshold.
    for (let i = 0; i < 150; i++) limiter.check(makeRequest("10.9.9.9"));
    expect(limiter.size).toBe(1);
  });
});

describe("rateLimiterPlugin path scoping", () => {
  it("only counts requests whose path matches", async () => {
    const app = new Elysia()
      .use(rateLimiterPlugin({ limit: 1, windowMs: 60_000, methods: ["POST"], path: /^\/login$/ }))
      .post("/login", () => ({ ok: true }))
      .post("/other", () => ({ ok: true }));

    const ip = "42.0.0.3";
    for (let i = 0; i < 5; i++) {
      expect((await app.handle(makeRequest(ip, "POST", "/other"))).status).toBe(200);
    }
    expect((await app.handle(makeRequest(ip, "POST", "/login"))).status).toBe(200);
    expect((await app.handle(makeRequest(ip, "POST", "/login"))).status).toBe(429);
  });

  it("two limiters with different scopes do not share a bucket", async () => {
    const app = new Elysia()
      .use(rateLimiterPlugin({ limit: 1, windowMs: 60_000, methods: ["POST"], path: /^\/a$/ }))
      .use(rateLimiterPlugin({ limit: 1, windowMs: 60_000, methods: ["POST"], path: /^\/b$/ }))
      .post("/a", () => ({ ok: true }))
      .post("/b", () => ({ ok: true }));

    const ip = "42.0.0.4";
    expect((await app.handle(makeRequest(ip, "POST", "/a"))).status).toBe(200);
    expect((await app.handle(makeRequest(ip, "POST", "/b"))).status).toBe(200);
    expect((await app.handle(makeRequest(ip, "POST", "/a"))).status).toBe(429);
    expect((await app.handle(makeRequest(ip, "POST", "/b"))).status).toBe(429);
  });
});
