import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
  process.env.AUTH_DISABLED = "true";
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  Reflect.deleteProperty(process.env, "AUTH_DISABLED");
  Reflect.deleteProperty(process.env, "SESSION_SECRET");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function getApp() {
  const { authRouter } = await import("./auth");
  const { Elysia } = await import("elysia");
  return new Elysia().use(authRouter);
}

async function getAppWithPlugin() {
  const { authRouter, authPlugin } = await import("./auth");
  const { Elysia } = await import("elysia");
  return new Elysia()
    .use(authPlugin)
    .use(authRouter)
    .get("/protected", () => ({ ok: true }));
}

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe("POST /auth/login", () => {
  test("returns 401 for non-existent user", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid credentials");
  });

  test("returns 200 and sets session cookie for valid credentials", async () => {
    const { openDb, createAdminUser } = await import("@webfrost/core");
    const db = openDb(testDir);
    await createAdminUser(db, "admin", "password123");
    db.close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // Session cookie should be set
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("session=");
  });

  test("returns 400 { error, code } for missing password field", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request", code: "VALIDATION" });
  });

  test("rejects passwords longer than 1024 characters before hashing them", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "x".repeat(1025) }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

describe("POST /auth/logout", () => {
  test("returns 204 and clears the session cookie", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: { cookie: "session=whatever" },
      }),
    );
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=;");
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  test("works with an expired or invalid session (auth enabled)", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getAppWithPlugin();
    const res = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: { cookie: "session=forged.or-expired" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

describe("GET /auth/me", () => {
  test("returns admin username when AUTH_DISABLED=true", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    // AUTH_DISABLED is already set in beforeEach

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/auth/me"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe("admin");
  });

  test("returns username from valid session cookie", async () => {
    const { openDb, createAdminUser } = await import("@webfrost/core");
    const db = openDb(testDir);
    await createAdminUser(db, "admin", "password123");
    db.close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    // Login first to get a session cookie
    const loginApp = await getApp();
    const loginRes = await loginApp.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" }),
      }),
    );
    const setCookie = loginRes.headers.get("set-cookie") ?? "";
    const sessionMatch = setCookie.match(/session=([^;]+)/);
    const sessionToken = sessionMatch?.[1] ?? "";

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `session=${sessionToken}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// authPlugin — API key validation and unauthorized access rejection
// ---------------------------------------------------------------------------

describe("authPlugin — API key validation", () => {
  test("rejects request with no auth (401)", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getAppWithPlugin();
    const res = await app.handle(new Request("http://localhost/protected"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  test("allows request with valid API key Bearer token", async () => {
    const { openDb, createApiKey } = await import("@webfrost/core");
    const db = openDb(testDir);
    const { rawKey } = createApiKey(db, "test-key");
    db.close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getAppWithPlugin();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { authorization: `Bearer ${rawKey}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("rejects request with invalid Bearer token (401)", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getAppWithPlugin();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { authorization: "Bearer invalid-key-xyz" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("bypasses auth when AUTH_DISABLED=true", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    // AUTH_DISABLED already set to "true" in beforeEach

    const app = await getAppWithPlugin();
    const res = await app.handle(new Request("http://localhost/protected"));
    expect(res.status).toBe(200);
  });

  test("login endpoint is accessible without auth", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");

    const app = await getAppWithPlugin();
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "nobody", password: "nopass" }),
      }),
    );
    // Should reach the handler (401 from bad creds), not be blocked by middleware
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid credentials");
  });
});

// ---------------------------------------------------------------------------
// Session revocation
// ---------------------------------------------------------------------------

describe("session revocation", () => {
  const SECRET = "test-secret-32-chars-long-enough!!";

  async function seed() {
    const { openDb, createAdminUser } = await import("@webfrost/core");
    const db = openDb(testDir);
    await createAdminUser(db, "admin", "password123");
    db.close();
    process.env.SESSION_SECRET = SECRET;
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
    process.env.NODE_ENV = "development";
  }

  function json(path: string, body: unknown, cookie?: string) {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  async function login(
    app: Awaited<ReturnType<typeof getAppWithPlugin>>,
    password = "password123",
  ) {
    const res = await app.handle(json("/auth/login", { username: "admin", password }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("no session cookie");
    return cookie;
  }

  const protectedStatus = async (
    app: Awaited<ReturnType<typeof getAppWithPlugin>>,
    cookie: string,
  ) =>
    (await app.handle(new Request("http://localhost/protected", { headers: { cookie } }))).status;

  test("logout invalidates the session server-side", async () => {
    await seed();
    const app = await getAppWithPlugin();
    const cookie = await login(app);
    expect(await protectedStatus(app, cookie)).toBe(200);

    const out = await app.handle(
      new Request("http://localhost/auth/logout", { method: "POST", headers: { cookie } }),
    );
    expect(out.status).toBe(204);

    // The same cookie replayed after logout no longer works.
    expect(await protectedStatus(app, cookie)).toBe(401);
  });

  test("logging in again revokes the session in the cookie it replaces", async () => {
    await seed();
    const app = await getAppWithPlugin();
    const first = await login(app);
    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: first },
        body: JSON.stringify({ username: "admin", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const second = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    expect(await protectedStatus(app, first)).toBe(401);
    expect(await protectedStatus(app, second)).toBe(200);
  });

  test("logging out one browser leaves the other signed in", async () => {
    await seed();
    const app = await getAppWithPlugin();
    const laptop = await login(app);
    const phone = await login(app);

    await app.handle(
      new Request("http://localhost/auth/logout", { method: "POST", headers: { cookie: laptop } }),
    );

    expect(await protectedStatus(app, laptop)).toBe(401);
    expect(await protectedStatus(app, phone)).toBe(200);
  });

  test("changing the password signs out other sessions and keeps the caller signed in", async () => {
    await seed();
    const app = await getAppWithPlugin();
    const mine = await login(app);
    const stolen = await login(app);

    const res = await app.handle(
      json(
        "/auth/change-password",
        { currentPassword: "password123", newPassword: "a-much-better-password" },
        mine,
      ),
    );
    expect(res.status).toBe(200);
    const renewed = res.headers.get("set-cookie")?.split(";")[0];
    if (!renewed) throw new Error("expected a renewed session cookie");

    expect(await protectedStatus(app, stolen)).toBe(401);
    expect(await protectedStatus(app, mine)).toBe(401);
    expect(await protectedStatus(app, renewed)).toBe(200);
    await login(app, "a-much-better-password");
  });

  test("a wrong current password is 403, not 401, and changes nothing", async () => {
    await seed();
    const app = await getAppWithPlugin();
    const cookie = await login(app);

    const res = await app.handle(
      json(
        "/auth/change-password",
        { currentPassword: "nope", newPassword: "a-much-better-password" },
        cookie,
      ),
    );

    expect(res.status).toBe(403);
    expect(await protectedStatus(app, cookie)).toBe(200);
  });

  test("a signed cookie that was never issued by login is rejected", async () => {
    await seed();
    const { createSessionToken } = await import("@webfrost/core");
    const app = await getAppWithPlugin();
    const forged = `session=${encodeURIComponent(createSessionToken(SECRET, "admin"))}`;
    expect(await protectedStatus(app, forged)).toBe(401);
  });
});
