import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey, openDb } from "@webfrost/core";
import { app, setUiAssets, withDefaultTheme } from "./index";

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

describe("rate limit on retrying snapshots", () => {
  test("retries count with snapshot creation: the 61st POST in a minute is refused", async () => {
    process.env.WEBFROST_TRUST_PROXY = "true";
    try {
      const retry = () =>
        app.handle(
          new Request("http://localhost/api/v1/snapshots/999999/retry", {
            method: "POST",
            headers: { ...authHeader, "x-forwarded-for": "203.0.113.77" },
          }),
        );
      for (let i = 0; i < 60; i++) expect((await retry()).status).toBe(404);
      const blocked = await retry();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_TRUST_PROXY");
    }
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

  test("a Bearer header does not exempt a cross-site request that carries the session cookie", async () => {
    // A proxy may inject its own Bearer token; auth then falls back to the cookie.
    const res = await app.handle(
      new Request("http://localhost/api/v1/tags", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer proxy-token",
          "sec-fetch-site": "same-site",
          cookie: "session=anything",
        },
        body: JSON.stringify({ name: "pwned-bearer" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("CROSS_ORIGIN_REQUEST");
    const tags = await app.handle(
      new Request("http://localhost/api/v1/tags", { headers: authHeader }),
    );
    expect(
      ((await tags.json()) as { items: { name: string }[] }).items.some(
        (t) => t.name === "pwned-bearer",
      ),
    ).toBe(false);
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

describe("WEBFROST_DEFAULT_THEME", () => {
  const html = "<html><head><title>x</title></head><body></body></html>";
  const saved = process.env.WEBFROST_DEFAULT_THEME;
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_DEFAULT_THEME");
    else process.env.WEBFROST_DEFAULT_THEME = saved;
    setUiAssets(undefined);
  });

  test("withDefaultTheme writes the meta tag for light and dark", () => {
    for (const theme of ["light", "dark"]) {
      process.env.WEBFROST_DEFAULT_THEME = theme;
      expect(withDefaultTheme(html)).toContain(
        `<meta name="webfrost-default-theme" content="${theme}" />\n</head>`,
      );
    }
  });

  test("withDefaultTheme leaves the page alone when unset or invalid", () => {
    Reflect.deleteProperty(process.env, "WEBFROST_DEFAULT_THEME");
    expect(withDefaultTheme(html)).toBe(html);
    process.env.WEBFROST_DEFAULT_THEME = '"><script>';
    expect(withDefaultTheme(html)).toBe(html);
  });

  test("the page served at / carries the meta tag", async () => {
    setUiAssets({ find: async (p) => (p === "/index.html" ? new Blob([html]) : null) });
    process.env.WEBFROST_DEFAULT_THEME = "dark";
    for (const path of ["/some/spa/route", "/", "/index.html"]) {
      const res = await app.handle(new Request(`http://localhost${path}`));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<meta name="webfrost-default-theme" content="dark" />');
    }
  });
});

describe("routing and the guards see the same path", () => {
  test("a short Host cannot route /api past the request guard and the rate limiter", async () => {
    // Elysia once routed http://a/XY/api/v1/… as /api/v1/… while every guard read /XY/api/v1/….
    const res = await app.handle(
      new Request("http://a/XY/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not json",
      }),
    );
    expect(res.status).not.toBe(415);
    expect([404, 401]).toContain(res.status);
  });
});

describe("body size", () => {
  test("a large JSON body is refused before it is read, except on the URL import", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const post = (path: string) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(big.length + 20),
          },
          body: JSON.stringify({ username: big, password: "x" }),
        }),
      );
    expect((await post("/api/v1/auth/login")).status).toBe(413);
    expect((await post("/api/v1/snapshots")).status).toBe(413);
    expect((await post("/api/v1/import")).status).not.toBe(413);
  });
});
