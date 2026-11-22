import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey, openDb } from "@webfrost/core";
import { app } from "./index";

// Routes that touch the archive must use a throwaway directory, never ~/.webfrost.
// Whether auth is on is decided once, when the server module first loads (another test file
// may load it first), so requests that must reach a route send a real API key: they work
// either way.
let testDir: string;
let authHeader: Record<string, string> = {};
beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "webfrost-index-test-"));
  process.env.WEBFROST_DIR = testDir;
  const db = await openDb(testDir);
  try {
    const { rawKey } = await createApiKey(db, "index-test");
    authHeader = { authorization: `Bearer ${rawKey}` };
  } finally {
    await db.close();
  }
});
afterAll(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  rmSync(testDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  test("returns 200 { status: ok }", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("security headers", () => {
  test("sets Content-Security-Policy on every response", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("sets X-Content-Type-Options: nosniff", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("sets X-Frame-Options: DENY", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("sets Referrer-Policy", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
}

describe("API errors", () => {
  test("unknown /api routes are a JSON 404, not the SPA", async () => {
    for (const path of [
      "/api/v1/nope",
      "/api/v1/snapshots/1/nope/deeper",
      "/api/v1",
      "/api/nope",
      "/api",
    ]) {
      const res = await app.handle(new Request(`http://localhost${path}`));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "not found", code: "NOT_FOUND" });
      expectSecurityHeaders(res);
    }
  });

  test("unknown routes for other methods are a JSON 404 with security headers", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/nope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
    expectSecurityHeaders(res);
  });

  test("malformed JSON is a JSON 400 with security headers", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("INVALID_JSON");
    expectSecurityHeaders(res);
  });

  test("validation errors keep their message and gain a code", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: 42 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid url", code: "VALIDATION" });
    expectSecurityHeaders(res);
  });

  test("route errors gain a code derived from the status", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/snapshots/999999", { headers: authHeader }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "NOT_FOUND" });
  });
});

describe("cross-origin and content-type protection", () => {
  test("a cross-site form post is refused before it reaches a route", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/tags", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-site",
          cookie: "session=anything",
        },
        body: "name=pwned",
      }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("CROSS_ORIGIN_REQUEST");
    expectSecurityHeaders(res);
  });

  test("a same-origin form-encoded body is refused with 415", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/tags", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-origin",
        },
        body: "name=pwned",
      }),
    );
    expect(res.status).toBe(415);
    const tags = await app.handle(
      new Request("http://localhost/api/v1/tags", { headers: authHeader }),
    );
    expect(
      ((await tags.json()) as { items: { name: string }[] }).items.some((t) => t.name === "pwned"),
    ).toBe(false);
  });
});

describe("listenHostname", () => {
  test("binds to loopback when auth is disabled", async () => {
    const { listenHostname } = await import("./index");
    expect(listenHostname({ AUTH_DISABLED: "true" })).toBe("127.0.0.1");
  });

  test("binds to all interfaces with auth on", async () => {
    const { listenHostname } = await import("./index");
    expect(listenHostname({})).toBe("0.0.0.0");
  });

  test("HOST always wins", async () => {
    const { listenHostname } = await import("./index");
    expect(listenHostname({ AUTH_DISABLED: "true", HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(listenHostname({ HOST: "10.0.0.2" })).toBe("10.0.0.2");
  });
});
