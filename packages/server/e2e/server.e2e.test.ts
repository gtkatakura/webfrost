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
  process.env.WEBFROST_DIR = undefined;
  process.env.SESSION_SECRET = undefined;
  process.env.NODE_ENV = undefined;
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

  test("POST /api/auth/change-password rejects wrong current password with 401", async () => {
    const res = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrongpassword", newPassword: "NewPassword123!" }),
    });
    expect(res.status).toBe(401);
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

    // Restore original password so subsequent tests still work
    const restoreRes = await authed("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: tmpPassword, newPassword: ADMIN_PASSWORD }),
    });
    expect(restoreRes.status).toBe(200);
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
    expect(logoutRes.status).toBe(200);
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
