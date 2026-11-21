/**
 * Server API E2E tests
 *
 * Starts a real HTTP server on a random port and exercises all REST API
 * endpoints over real HTTP using fetch(). Auth is enabled (SESSION_SECRET is
 * set before the server module is imported) so session-cookie and API-key
 * flows are validated against the real middleware stack.
 *
 * Run with:
 *   bun test e2e/
 * from the packages/server directory, or:
 *   bun run test:e2e
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Elysia } from "elysia";

// Fixed test credentials — not a production secret
const SESSION_SECRET = "e2e-test-secret-32-chars-long-ok!";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "TestPassword123!";

// Populated in beforeAll
let baseUrl = "";
let sessionCookie = "";
let serverApp: Elysia;
let testDir = "";

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  testDir = join(tmpdir(), `webfrost-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });

  // Set env vars BEFORE importing the server — the module-level check reads
  // SESSION_SECRET at import time and calls process.exit(1) when it is absent.
  process.env.WEBFROST_DIR = testDir;
  process.env.SESSION_SECRET = SESSION_SECRET;
  // Disable the `secure` cookie flag so the test server (plain HTTP) can set
  // and receive session cookies.
  process.env.NODE_ENV = "development";
  // The rate-limit tests isolate themselves with X-Forwarded-For, which the server
  // only honours when told it sits behind a proxy.
  process.env.WEBFROST_TRUST_PROXY = "true";

  const mod = await import("../src/index.ts");
  serverApp = mod.app;
  // Port 0 → OS picks an available port.
  serverApp.listen(0);

  const port = serverApp.server?.port;
  if (!port) throw new Error("Server failed to bind to a port");
  baseUrl = `http://localhost:${port}`;

  // Seed admin user directly via core (avoids bootstrapping via /api/setup
  // which would conflict with the "setup status" tests below).
  const { openDb, createAdminUser } = await import("@webfrost/core");
  const db = openDb(testDir);
  await createAdminUser(db, ADMIN_USERNAME, ADMIN_PASSWORD);
  db.close();

  // Obtain a session cookie that tests can reuse.
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (loginRes.status !== 200) throw new Error("Admin login failed during test setup");
  // The cookie header is e.g. "session=<token>; Path=/; HttpOnly; SameSite=Strict"
  const rawCookie = loginRes.headers.get("set-cookie") ?? "";
  sessionCookie = rawCookie.split(";")[0] ?? "";
  if (!sessionCookie.startsWith("session=")) {
    throw new Error(`Unexpected session cookie: ${rawCookie}`);
  }
});

afterAll(() => {
  serverApp?.stop();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  Reflect.deleteProperty(process.env, "SESSION_SECRET");
  Reflect.deleteProperty(process.env, "NODE_ENV");
  Reflect.deleteProperty(process.env, "WEBFROST_TRUST_PROXY");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch with the session cookie pre-set. */
function authed(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("cookie", sessionCookie);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

/** After a password change the server issues a new session cookie; keep using it. */
function adoptRenewedSession(res: Response): void {
  const renewed = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (!renewed.startsWith("session=")) throw new Error("expected a renewed session cookie");
  sessionCookie = renewed;
}

/** Fetch with a Bearer API key pre-set. */
function withKey(path: string, key: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${key}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("health", () => {
  test("GET /health returns 200 { status: ok }", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("security headers", () => {
  test("response includes required security headers", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});

describe("setup", () => {
  test("GET /api/setup/status is public and returns needsSetup: false when admin exists", async () => {
    // Public endpoint — no cookie required
    const res = await fetch(`${baseUrl}/api/setup/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needsSetup: boolean };
    expect(body.needsSetup).toBe(false);
  });

  test("POST /api/setup returns 409 when admin already exists", async () => {
    const res = await fetch(`${baseUrl}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin2", password: "password123" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("auth", () => {
  test("POST /api/auth/login with wrong password returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid credentials");
  });

  test("POST /api/auth/login with correct credentials sets session cookie", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  test("GET /api/auth/me with valid session returns username", async () => {
    const res = await authed("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe(ADMIN_USERNAME);
  });

  test("GET /api/auth/me without credentials returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  test("POST /api/auth/change-password rejects wrong current password with 403", async () => {
    const res = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrongpassword", newPassword: "NewPassword123!" }),
    });
    // 403, not 401: the session is fine, the supplied password is not.
    expect(res.status).toBe(403);
    expect((await authed("/api/auth/me")).status).toBe(200);
  });

  test("POST /api/auth/change-password rejects short new password with 400", async () => {
    const res = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: "short" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("8 characters");
  });

  test("POST /api/auth/change-password with valid credentials returns 200", async () => {
    const tmpPassword = "TmpNewPassword456!";
    const changeRes = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: tmpPassword }),
    });
    expect(changeRes.status).toBe(200);

    // A password change revokes every session and hands the caller a new cookie.
    const staleCookie = sessionCookie;
    adoptRenewedSession(changeRes);
    expect(sessionCookie).not.toBe(staleCookie);
    const staleRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: staleCookie } });
    expect(staleRes.status).toBe(401);

    // Restore original password so subsequent tests still work
    const restoreRes = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: tmpPassword, newPassword: ADMIN_PASSWORD }),
    });
    expect(restoreRes.status).toBe(200);
    adoptRenewedSession(restoreRes);
    expect((await authed("/api/auth/me")).status).toBe(200);
  });

  test("POST /api/auth/logout clears session", async () => {
    // Log in with a fresh session
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    });
    const freshCookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: freshCookie },
    });
    expect(logoutRes.status).toBe(204);
    expect(logoutRes.headers.get("set-cookie") ?? "").toMatch(/session=;.*Max-Age=0/i);

    // The cookie is dead on the server, not just cleared in the browser.
    const replay = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: freshCookie } });
    expect(replay.status).toBe(401);
    // Other sessions are untouched.
    expect((await authed("/api/auth/me")).status).toBe(200);

    // Logging out again with the now-dead cookie still clears it.
    const again = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: freshCookie },
    });
    expect(again.status).toBe(204);
  });
});

describe("CSRF and content-type protection", () => {
  test("a cross-site form post with the session cookie is refused", async () => {
    const res = await authed("/api/tags", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-site",
      },
      body: "name=csrf-tag",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("CROSS_ORIGIN_REQUEST");
    const tags = (await (await authed("/api/tags")).json()) as { name: string }[];
    expect(tags.some((t) => t.name === "csrf-tag")).toBe(false);
  });

  test("an Origin from another site is refused when fetch metadata is absent", async () => {
    const res = await authed("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    // The session survived.
    expect((await authed("/api/auth/me")).status).toBe(200);
  });

  test("the UI's same-origin JSON fetch works", async () => {
    const res = await authed("/api/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        origin: baseUrl,
      },
      body: JSON.stringify({ name: "same-origin-tag" }),
    });
    expect(res.status).toBe(201);
  });

  test("a non-JSON body on a JSON route is a 415", async () => {
    const res = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(415);
  });

  test("unknown API routes are a JSON 404", async () => {
    const res = await authed("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "NOT_FOUND" });
  });
});

describe("protected endpoints — unauthenticated access returns 401", () => {
  const protectedGets = [
    "/api/snapshots",
    "/api/tags",
    "/api/schedules",
    "/api/stats",
    "/api/settings/info",
    "/api/settings/keys",
    "/api/imports",
    "/api/auth/me",
  ];

  for (const path of protectedGets) {
    test(`GET ${path} without auth → 401`, async () => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(401);
    });
  }

  test("POST /api/snapshots without auth → 401", async () => {
    const res = await fetch(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("API key authentication", () => {
  let apiKeyId = "";
  let rawApiKey = "";

  test("POST /api/settings/keys creates API key and returns rawKey once", async () => {
    const res = await authed("/api/settings/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "e2e-test-key" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; rawKey: string };
    expect(body.name).toBe("e2e-test-key");
    expect(typeof body.rawKey).toBe("string");
    expect(body.rawKey.length).toBeGreaterThan(10);
    apiKeyId = body.id;
    rawApiKey = body.rawKey;
  });

  test("protected endpoint accessible with valid API key", async () => {
    const res = await withKey("/api/snapshots", rawApiKey);
    expect(res.status).toBe(200);
  });

  test("protected endpoint returns 401 with invalid API key", async () => {
    const res = await withKey("/api/snapshots", "invalid-key-value");
    expect(res.status).toBe(401);
  });

  test("GET /api/settings/keys lists the created key", async () => {
    const res = await authed("/api/settings/keys");
    expect(res.status).toBe(200);
    const keys = (await res.json()) as Array<{ id: string; name: string }>;
    const found = keys.find((k) => k.id === apiKeyId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("e2e-test-key");
  });

  test("DELETE /api/settings/keys/:id revokes key (204)", async () => {
    const res = await authed(`/api/settings/keys/${apiKeyId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("revoked key no longer authenticates", async () => {
    const res = await withKey("/api/snapshots", rawApiKey);
    expect(res.status).toBe(401);
  });

  test("DELETE /api/settings/keys/:id returns 404 for unknown key", async () => {
    const res = await authed("/api/settings/keys/nonexistent-id", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("snapshots", () => {
  let snapshotId: number;

  test("GET /api/snapshots returns empty list initially", async () => {
    const res = await authed("/api/snapshots");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("POST /api/snapshots with valid URL returns 202 and snapshot id", async () => {
    const res = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: number; url: string; status: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.url).toBe("https://example.com");
    expect(body.status).toBe("pending");
    snapshotId = body.id;
  });

  test("POST /api/snapshots with invalid URL returns 400", async () => {
    const res = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid url");
  });

  test("POST /api/snapshots with non-HTTP protocol returns 400", async () => {
    const res = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "ftp://example.com" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/snapshots returns the created snapshot", async () => {
    const res = await authed("/api/snapshots");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: number; url: string }> };
    const found = body.items.find((s) => s.id === snapshotId);
    expect(found).toBeDefined();
    expect(found?.url).toBe("https://example.com");
  });

  test("GET /api/snapshots?page=1&limit=5 respects pagination params", async () => {
    const res = await authed("/api/snapshots?page=1&limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; page: number; limit: number };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.items.length).toBeLessThanOrEqual(5);
  });

  test("GET /api/snapshots?q=example returns valid search response structure", async () => {
    // FTS index is populated only after pipeline completion, so we just verify
    // the endpoint returns the correct paginated response structure.
    const res = await authed("/api/snapshots?q=example");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; url: string }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.page).toBe("number");
    expect(typeof body.limit).toBe("number");
  });

  test("GET /api/snapshots/:id returns snapshot detail", async () => {
    const res = await authed(`/api/snapshots/${snapshotId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; url: string; status: string };
    expect(body.id).toBe(snapshotId);
    expect(body.url).toBe("https://example.com");
    expect(typeof body.status).toBe("string");
  });

  test("GET /api/snapshots/999999 returns 404", async () => {
    const res = await authed("/api/snapshots/999999");
    expect(res.status).toBe(404);
  });

  test("GET /api/snapshots/abc returns 404 (non-numeric id)", async () => {
    const res = await authed("/api/snapshots/abc");
    expect(res.status).toBe(404);
  });

  test("DELETE /api/snapshots/:id returns 204", async () => {
    const res = await authed(`/api/snapshots/${snapshotId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("GET /api/snapshots/:id after deletion returns 404", async () => {
    const res = await authed(`/api/snapshots/${snapshotId}`);
    expect(res.status).toBe(404);
  });

  test("DELETE /api/snapshots/999999 returns 404", async () => {
    const res = await authed("/api/snapshots/999999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("download endpoint", () => {
  test("unknown extractor returns 400", async () => {
    // Need a snapshot id that exists — create one for this test
    const createRes = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://download-test.example.com" }),
    });
    expect(createRes.status).toBe(202);
    const { id } = (await createRes.json()) as { id: number };

    const res = await authed(`/api/snapshots/${id}/archives/unknownextractor/download`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown extractor");

    // Cleanup
    await authed(`/api/snapshots/${id}`, { method: "DELETE" });
  });

  test("known extractor on snapshot with no archive returns 404", async () => {
    const createRes = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://download-missing.example.com" }),
    });
    expect(createRes.status).toBe(202);
    const { id } = (await createRes.json()) as { id: number };

    // html extractor — snapshot exists but pipeline hasn't completed, so no archive
    const res = await authed(`/api/snapshots/${id}/archives/html/download`);
    expect(res.status).toBe(404);

    await authed(`/api/snapshots/${id}`, { method: "DELETE" });
  });

  test("non-numeric snapshot id returns 404", async () => {
    const res = await authed("/api/snapshots/abc/archives/html/download");
    expect(res.status).toBe(404);
  });

  test("non-existent snapshot id returns 404", async () => {
    const res = await authed("/api/snapshots/999999/archives/html/download");
    expect(res.status).toBe(404);
  });
});

describe("tags", () => {
  let tagId: number;
  let snapshotId: number;

  test("GET /api/tags returns list (may be empty)", async () => {
    const res = await authed("/api/tags");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST /api/tags creates a new tag (201)", async () => {
    const res = await authed("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "e2e-tag", color: "#ff0000" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; name: string; slug: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe("e2e-tag");
    expect(typeof body.slug).toBe("string");
    tagId = body.id;
  });

  test("POST /api/tags duplicate returns 409", async () => {
    const res = await authed("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "e2e-tag" }),
    });
    expect(res.status).toBe(409);
  });

  test("GET /api/tags lists the created tag", async () => {
    const res = await authed("/api/tags");
    const tags = (await res.json()) as Array<{ id: number; name: string }>;
    expect(tags.some((t) => t.id === tagId)).toBe(true);
  });

  test("snapshot tag flow: add, list, remove", async () => {
    // Create a snapshot to attach the tag to
    const snapRes = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://tag-test.example.com" }),
    });
    expect(snapRes.status).toBe(202);
    ({ id: snapshotId } = (await snapRes.json()) as { id: number });

    // Add tag to snapshot
    const addRes = await authed(`/api/snapshots/${snapshotId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
    expect(addRes.status).toBe(201);

    // List tags on snapshot
    const listRes = await authed(`/api/snapshots/${snapshotId}/tags`);
    expect(listRes.status).toBe(200);
    const snapshotTags = (await listRes.json()) as Array<{ id: number }>;
    expect(snapshotTags.some((t) => t.id === tagId)).toBe(true);

    // Remove tag from snapshot
    const removeTagRes = await authed(`/api/snapshots/${snapshotId}/tags/${tagId}`, {
      method: "DELETE",
    });
    expect(removeTagRes.status).toBe(204);

    // Cleanup snapshot
    await authed(`/api/snapshots/${snapshotId}`, { method: "DELETE" });
  });

  test("GET /api/snapshots/999999/tags returns 404 for unknown snapshot", async () => {
    const res = await authed("/api/snapshots/999999/tags");
    expect(res.status).toBe(404);
  });

  test("DELETE /api/tags/:id removes the tag (204)", async () => {
    const res = await authed(`/api/tags/${tagId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("DELETE /api/tags/999999 returns 404", async () => {
    const res = await authed("/api/tags/999999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("schedules", () => {
  let scheduleId: number;

  test("GET /api/schedules returns empty list initially", async () => {
    const res = await authed("/api/schedules");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST /api/schedules with valid cron returns 201", async () => {
    const res = await authed("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://schedule-test.example.com", cron: "0 * * * *" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      url: string;
      cron: string;
      paused: boolean;
    };
    expect(body.id).toBeGreaterThan(0);
    expect(body.url).toBe("https://schedule-test.example.com");
    expect(body.cron).toBe("0 * * * *");
    expect(body.paused).toBe(false);
    scheduleId = body.id;
  });

  test("POST /api/schedules with invalid URL returns 400", async () => {
    const res = await authed("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url", cron: "0 * * * *" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/schedules/:id returns schedule", async () => {
    const res = await authed(`/api/schedules/${scheduleId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; paused: boolean };
    expect(body.id).toBe(scheduleId);
  });

  test("GET /api/schedules/999999 returns 404", async () => {
    const res = await authed("/api/schedules/999999");
    expect(res.status).toBe(404);
  });

  test("PATCH /api/schedules/:id pauses the schedule", async () => {
    const res = await authed(`/api/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean };
    expect(body.paused).toBe(true);
  });

  test("PATCH /api/schedules/:id resumes the schedule", async () => {
    const res = await authed(`/api/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean };
    expect(body.paused).toBe(false);
  });

  test("PATCH /api/schedules/999999 returns 404", async () => {
    const res = await authed("/api/schedules/999999", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/schedules/:id removes the schedule (204)", async () => {
    const res = await authed(`/api/schedules/${scheduleId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("DELETE /api/schedules/999999 returns 404", async () => {
    const res = await authed("/api/schedules/999999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("settings", () => {
  test("GET /api/settings/info returns version and storagePath", async () => {
    const res = await authed("/api/settings/info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      storagePath: string;
      snapshotCount: number;
    };
    expect(typeof body.version).toBe("string");
    expect(body.storagePath).toBe(testDir);
    expect(typeof body.snapshotCount).toBe("number");
  });
});

describe("stats", () => {
  test("GET /api/stats returns stats object", async () => {
    const res = await authed("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });
});

describe("import", () => {
  test("POST /api/import with text content returns 202", async () => {
    const res = await authed("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "https://import-test-a.example.com\nhttps://import-test-b.example.com",
        format: "text",
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { queued: number; skipped: number };
    expect(typeof body.queued).toBe("number");
    expect(typeof body.skipped).toBe("number");
    expect(body.queued).toBeGreaterThanOrEqual(1);
  });

  test("POST /api/import: text format queues the same URL again (no deduplication for non-RSS)", async () => {
    // The import route only deduplicates for RSS format. Text imports always queue.
    const payload = {
      content: "https://no-dedup-test.example.com",
      format: "text",
    };
    const first = await authed("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { queued: number; skipped: number };
    expect(firstBody.queued).toBe(1);
    expect(firstBody.skipped).toBe(0);

    // Second import of same URL — text format does not deduplicate
    const second = await authed("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as { queued: number; skipped: number };
    expect(secondBody.queued).toBe(1);
    expect(secondBody.skipped).toBe(0);
  });

  test("GET /api/imports lists import history", async () => {
    const res = await authed("/api/imports");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("rate limiting", () => {
  // Use a unique forwarded IP so this test's request counts are isolated
  // from other tests sharing the "unknown" default IP bucket.
  const RATE_LIMIT_IP = "192.0.2.99";

  test("POST /api/snapshots returns 429 after exceeding 60 req/min limit", async () => {
    // Send 60 requests (the limit) — all should succeed
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": RATE_LIMIT_IP,
      cookie: sessionCookie,
    };
    const body = JSON.stringify({ url: "http://localhost:1" }); // fast-fail URL

    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${baseUrl}/api/snapshots`, { method: "POST", headers, body });
      expect(res.status).toBe(202);
    }

    // 61st request must be rate-limited
    const limitedRes = await fetch(`${baseUrl}/api/snapshots`, { method: "POST", headers, body });
    expect(limitedRes.status).toBe(429);
    const limitedBody = (await limitedRes.json()) as { error: string };
    expect(limitedBody.error).toBe("rate limit exceeded");
    expect(limitedRes.headers.get("retry-after")).toBeDefined();
  });
});

describe("login rate limiting", () => {
  test("the 11th password attempt in a minute from one client is rejected with 429", async () => {
    const headers = { "content-type": "application/json", "x-forwarded-for": "192.0.2.50" };
    const body = JSON.stringify({ username: ADMIN_USERNAME, password: "definitely-wrong" });

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers, body });
      expect(res.status).toBe(401);
    }
    const limited = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers, body });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // Another client is unaffected.
    const other = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { ...headers, "x-forwarded-for": "192.0.2.51" },
      body,
    });
    expect(other.status).toBe(401);
  });
});

describe("archive → search round trip", () => {
  let origin: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    origin = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          `<!doctype html><html><head><title>Permafrost Notes</title></head><body><article>
           <h1>Permafrost Notes</h1>
           <p>${"The tundra thaws a little more every summer. ".repeat(25)}</p>
           <p>Literal markup in the text: &lt;img src=x onerror=alert(1)&gt; near cryosphere.</p>
           </article></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    // The fixture origin is on loopback, which the SSRF guard blocks by default.
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
  });

  afterAll(() => {
    origin.stop(true);
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
    Reflect.deleteProperty(process.env, "WEBFROST_DOMAIN_DELAY_MS");
  });

  async function waitUntilSettled(id: number): Promise<string> {
    for (let i = 0; i < 300; i++) {
      const res = await authed(`/api/snapshots/${id}`);
      const { status } = (await res.json()) as { status: string };
      if (status !== "pending") return status;
      await Bun.sleep(200);
    }
    return "pending";
  }

  test("a snapshot created over HTTP is archived, summarised and searchable", async () => {
    const url = `http://127.0.0.1:${origin.port}/notes`;
    const created = await authed("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.60" },
      body: JSON.stringify({ url }),
    });
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: number };

    expect(await waitUntilSettled(id)).toBe("done");

    // Detail carries the same summary fields as the list.
    const detail = (await (await authed(`/api/snapshots/${id}`)).json()) as {
      title: string;
      extractors: string[];
      tags: unknown[];
      extractorMeta: Record<string, { status: string }>;
    };
    expect(detail.title).toBe("Permafrost Notes");
    expect(detail.extractors).toEqual(expect.arrayContaining(["html", "warc", "readability"]));
    expect(detail.tags).toEqual([]);
    // Every browser extractor is accounted for, whether Chromium is installed or not.
    for (const name of ["pdf", "screenshot", "dom-snapshot", "singlefile"]) {
      expect(["success", "failed"]).toContain(detail.extractorMeta[name]?.status ?? "missing");
    }

    // Search hits carry status/title/extractors and an escaped snippet.
    const search = (await (await authed("/api/snapshots?q=cryosphere")).json()) as {
      total: number;
      items: { id: number; snippet: string; status: string; title: string; extractors: string[] }[];
    };
    expect(search.total).toBe(1);
    const hit = search.items[0];
    expect(hit?.id).toBe(id);
    expect(hit?.status).toBe("done");
    expect(hit?.title).toBe("Permafrost Notes");
    expect(hit?.extractors).toContain("readability");
    expect(hit?.snippet).toContain("<mark>cryosphere</mark>");
    expect(hit?.snippet).not.toContain("<img");
  }, 120_000);

  test("URLs imported over HTTP are archived too", async () => {
    const base = `http://127.0.0.1:${origin.port}`;
    const res = await authed("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.61" },
      body: JSON.stringify({ content: `${base}/imported-a\n${base}/imported-b\n`, format: "text" }),
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { queued: number }).queued).toBe(2);

    let pending = 2;
    for (let i = 0; i < 300 && pending > 0; i++) {
      await Bun.sleep(200);
      const list = (await (await authed("/api/snapshots?limit=1000")).json()) as {
        items: { url: string; status: string }[];
      };
      const imported = list.items.filter((s) => s.url.includes("/imported-"));
      pending = imported.filter((s) => s.status === "pending").length;
      if (pending === 0) expect(imported.map((s) => s.status)).toEqual(["done", "done"]);
    }
    expect(pending).toBe(0);
  }, 120_000);
});

describe("archive preview", () => {
  test("serves archived HTML with a sandbox policy and refuses other formats", async () => {
    // Seed a finished snapshot with a DOM snapshot on disk — no browser needed.
    const { openDb, createStorageBackend } = await import("@webfrost/core");
    const db = openDb(testDir);
    const { id } = db
      .query<{ id: number }, []>(
        "INSERT INTO snapshots (url, status) VALUES ('https://preview.example/', 'done') RETURNING id",
      )
      .get() as { id: number };
    const hostile =
      "<html><body><h1>archived</h1><script>top.location='https://evil.example'</script></body></html>";
    const ref = await createStorageBackend(testDir).putText(id, "dom.html", hostile);
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'dom-snapshot', ?)",
    ).run(id, ref);
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', '<p>raw</p>')",
    ).run(id);
    db.close();

    const res = await authed(`/api/snapshots/${id}/archives/dom-snapshot/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(hostile);

    // The policy that makes rendering it safe: opaque origin, no scripts, no network.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("allow-scripts");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBeNull();

    // Only the HTML formats have a preview; everything else stays download-only.
    expect((await authed(`/api/snapshots/${id}/archives/html/preview`)).status).toBe(400);
    expect((await authed(`/api/snapshots/${id}/archives/singlefile/preview`)).status).toBe(404);
    expect(
      (await fetch(`${baseUrl}/api/snapshots/${id}/archives/dom-snapshot/preview`)).status,
    ).toBe(401);

    // Downloads are still attachments, and the app shell still forbids being framed.
    const download = await authed(`/api/snapshots/${id}/archives/dom-snapshot/download`);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const shell = await fetch(`${baseUrl}/health`);
    expect(shell.headers.get("x-frame-options")).toBe("DENY");
    expect(shell.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("public read / private write", () => {
  let snapshotId = 0;
  let storedRef = "";

  beforeAll(async () => {
    const { openDb, createStorageBackend } = await import("@webfrost/core");
    const db = openDb(testDir);
    snapshotId = (
      db
        .query<{ id: number }, []>(
          "INSERT INTO snapshots (url, status) VALUES ('https://public.example/', 'done') RETURNING id",
        )
        .get() as { id: number }
    ).id;
    storedRef = await createStorageBackend(testDir).putText(
      snapshotId,
      "dom.html",
      "<html><body>public page</body></html>",
    );
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'dom-snapshot', ?)",
    ).run(snapshotId, storedRef);
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'readability', ?)",
    ).run(snapshotId, JSON.stringify({ title: "Public page", textContent: "public page" }));
    db.close();
    process.env.WEBFROST_PUBLIC_READ = "true";
  });

  afterAll(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_PUBLIC_READ");
  });

  const anon = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);
  const jsonBody = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  test("setup status advertises the mode", async () => {
    const body = (await (await anon("/api/setup/status")).json()) as { publicRead: boolean };
    expect(body.publicRead).toBe(true);
  });

  test("anonymous visitors can browse snapshots, tags, stats and files", async () => {
    for (const path of [
      "/api/snapshots",
      "/api/snapshots?q=public",
      `/api/snapshots/${snapshotId}`,
      `/api/snapshots/${snapshotId}/tags`,
      `/api/snapshots/${snapshotId}/archives/dom-snapshot/download`,
      `/api/snapshots/${snapshotId}/archives/dom-snapshot/preview`,
      "/api/tags",
      "/api/stats",
    ]) {
      const res = await anon(path);
      expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
    }
  });

  test("anonymous visitors cannot change anything", async () => {
    const attempts: [string, RequestInit][] = [
      ["/api/snapshots", jsonBody({ url: "https://example.com" })],
      [`/api/snapshots/${snapshotId}`, { method: "DELETE" }],
      ["/api/tags", jsonBody({ name: "anon-tag" })],
      [`/api/snapshots/${snapshotId}/tags`, jsonBody({ tagId: 1 })],
      ["/api/import", jsonBody({ content: "https://example.com", format: "text" })],
      ["/api/schedules", jsonBody({ url: "https://example.com", cron: "* * * * *" })],
      ["/api/settings/keys", jsonBody({ name: "anon-key" })],
      [
        "/api/auth/change-password",
        jsonBody({ currentPassword: ADMIN_PASSWORD, newPassword: "anon-password-1" }),
      ],
    ];
    for (const [path, init] of attempts) {
      const res = await anon(path, init);
      expect(`${init.method} ${path} → ${res.status}`).toBe(`${init.method} ${path} → 401`);
    }
    // The snapshot is still there.
    expect((await anon(`/api/snapshots/${snapshotId}`)).status).toBe(200);
  });

  test("private read routes stay private", async () => {
    for (const path of [
      "/api/auth/me",
      "/api/schedules",
      "/api/imports",
      "/api/settings/info",
      "/api/settings/keys",
    ]) {
      const res = await anon(path);
      expect(`${path} → ${res.status}`).toBe(`${path} → 401`);
    }
  });

  test("storage paths are shown to the admin but not to anonymous visitors", async () => {
    type Detail = { archiveResults: { extractor: string; content: string }[] };
    const contentOf = (d: Detail, extractor: string) =>
      d.archiveResults.find((r) => r.extractor === extractor)?.content;

    const asGuest = (await (await anon(`/api/snapshots/${snapshotId}`)).json()) as Detail;
    expect(contentOf(asGuest, "dom-snapshot")).toBe(
      `/api/snapshots/${snapshotId}/archives/dom-snapshot/download`,
    );
    expect(JSON.stringify(asGuest)).not.toContain(testDir);
    // Inline content (article text) is the archive itself and stays readable.
    expect(contentOf(asGuest, "readability")).toContain("Public page");

    const asAdmin = (await (await authed(`/api/snapshots/${snapshotId}`)).json()) as Detail;
    expect(contentOf(asAdmin, "dom-snapshot")).toBe(storedRef);
  });

  test("turning the mode off closes the archive again", async () => {
    Reflect.deleteProperty(process.env, "WEBFROST_PUBLIC_READ");
    try {
      expect((await anon("/api/snapshots")).status).toBe(401);
      expect((await anon(`/api/snapshots/${snapshotId}`)).status).toBe(401);
      const status = (await (await anon("/api/setup/status")).json()) as { publicRead: boolean };
      expect(status.publicRead).toBe(false);
    } finally {
      process.env.WEBFROST_PUBLIC_READ = "true";
    }
  });
});

describe("review regressions", () => {
  test("two simultaneous setup requests cannot create two admins", async () => {
    // The admin already exists here, so both must be refused — and stay refused
    // even when they race each other past the first existence check.
    const attempt = (username: string) =>
      fetch(`${baseUrl}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.70" },
        body: JSON.stringify({ username, password: "another-password-1" }),
      });
    const [a, b] = await Promise.all([attempt("second"), attempt("third")]);
    expect([a.status, b.status]).toEqual([409, 409]);

    const { openDb } = await import("@webfrost/core");
    const db = openDb(testDir);
    try {
      expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM admin_users").get()?.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test("only the exact login and setup paths are public", async () => {
    // An existing protected route whose path ends like a public one must still ask
    // for credentials: /api/snapshots/:id/tags with a crafted id is the closest
    // real example, POST /api/snapshots/setup/tags does not exist but GET-able
    // siblings do.
    const post = (path: string) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.71" },
        body: "{}",
      });
    // Paths that only end like a public route are never served anonymously.
    for (const path of ["/api/snapshots/setup", "/api/tags/auth/login", "/api/x/setup/"]) {
      const res = await post(path);
      expect([401, 404]).toContain(res.status);
    }
    // The real ones still are (wrong credentials → 401 from the handler, not from auth;
    // setup → 409 because the admin exists).
    expect((await post("/api/setup")).status).not.toBe(401);
  });

  test("fractional paging values do not break the list or the search", async () => {
    const list = await authed("/api/snapshots?limit=2.5&page=1.5");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { limit: number; page: number; items: unknown[] };
    expect(listBody.limit).toBe(2);
    expect(listBody.page).toBe(1);
    expect(listBody.items.length).toBeGreaterThan(0);

    const search = await authed("/api/snapshots?q=cryosphere&limit=1.9");
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { total: number; limit: number; items: unknown[] };
    expect(searchBody.limit).toBe(1);
    expect(searchBody.items).toHaveLength(1);
    expect(searchBody.total).toBeGreaterThanOrEqual(1);
  });

  test("search honours the status filter", async () => {
    const total = async (query: string) =>
      ((await (await authed(`/api/snapshots?${query}`)).json()) as { total: number }).total;

    const all = await total("q=cryosphere");
    expect(all).toBeGreaterThanOrEqual(1);
    // Every snapshot that matches was archived successfully.
    expect(await total("q=cryosphere&status=done")).toBe(all);
    expect(await total("q=cryosphere&status=failed")).toBe(0);
  });
});

describe("list ordering", () => {
  test("the first page holds the most recently created snapshots", async () => {
    const list = (await (await authed("/api/snapshots?limit=5")).json()) as {
      total: number;
      items: { id: number }[];
    };
    const ids = list.items.map((s) => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    // The newest snapshot overall is on page 1, however many older ones exist.
    const { openDb } = await import("@webfrost/core");
    const db = openDb(testDir);
    try {
      const newest = db.query<{ id: number }, []>("SELECT MAX(id) AS id FROM snapshots").get()?.id;
      expect(ids[0]).toBe(newest as number);
      expect(list.total).toBeGreaterThan(5);
    } finally {
      db.close();
    }
  });
});
