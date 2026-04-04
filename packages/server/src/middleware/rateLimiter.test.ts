import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { createRateLimiter, rateLimiterPlugin } from "./rateLimiter";

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

  it("uses the first IP from x-forwarded-for chain", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.10.11.12" },
    });
    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).allowed).toBe(false);
    // Different first IP should be allowed
    const req2 = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "9.10.11.12" },
    });
    expect(limiter.check(req2).allowed).toBe(true);
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
    expect(body).toEqual({ error: "rate limit exceeded" });
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
