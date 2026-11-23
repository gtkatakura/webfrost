import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "webfrost-settings-test-"));
  process.env.WEBFROST_DIR = testDir;
});

afterEach(async () => {
  // Each test archive is its own database; release the pools so a server-backed run does not pile up connections.
  const { closeDatabases } = await import("@webfrost/core");
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  rmSync(testDir, { recursive: true, force: true });
});

async function createKey(name: string) {
  const { settingsRouter } = await import("./settings");
  const { Elysia } = await import("elysia");
  return new Elysia().use(settingsRouter).handle(
    new Request("http://localhost/settings/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

describe("POST /settings/keys", () => {
  test("creates a key", async () => {
    const res = await createKey("ci");
    expect(res.status).toBe(201);
  });

  test("rejects key names longer than 100 characters with a JSON 400", async () => {
    const res = await createKey("k".repeat(101));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request", code: "VALIDATION" });
  });
});

describe("POST /settings/keys with an API key", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();

  afterEach(() => {
    Reflect.deleteProperty(process.env, "SESSION_SECRET");
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
  });

  /** Seed one key, call POST /settings/keys through the auth plugin with it, list the keys. */
  async function mintWith(callerExpiresAt: string | undefined, body: Record<string, unknown>) {
    const { openDb, createApiKey, listApiKeys } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const { rawKey } = await createApiKey(db, "caller", callerExpiresAt);
    await db.close();
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
    const { authPlugin } = await import("./auth");
    const { settingsRouter } = await import("./settings");
    const { Elysia } = await import("elysia");
    const res = await new Elysia()
      .use(authPlugin)
      .use(settingsRouter)
      .handle(
        new Request("http://localhost/settings/keys", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${rawKey}` },
          body: JSON.stringify(body),
        }),
      );
    const after = await openDb(testDir);
    try {
      return { res, names: (await listApiKeys(after)).map((k) => k.name) };
    } finally {
      await after.close();
    }
  }

  test("an expiring key cannot mint a key that never expires", async () => {
    const { res, names } = await mintWith(iso(Date.now() + DAY), { name: "forever" });
    expect(res.status).toBe(403);
    expect(names).toEqual(["caller"]);
  });

  test("an expiring key cannot mint a key that outlives it", async () => {
    const { res, names } = await mintWith(iso(Date.now() + DAY), {
      name: "longer",
      expiresAt: iso(Date.now() + 30 * DAY),
    });
    expect(res.status).toBe(403);
    expect(names).toEqual(["caller"]);
  });

  test("an expiring key can mint a key that expires no later than itself", async () => {
    const { res, names } = await mintWith(iso(Date.now() + 2 * DAY), {
      name: "shorter",
      expiresAt: iso(Date.now() + DAY),
    });
    expect(res.status).toBe(201);
    expect(names).toEqual(["caller", "shorter"]);
  });

  test("a key that never expires can mint one that never expires", async () => {
    const { res, names } = await mintWith(undefined, { name: "forever" });
    expect(res.status).toBe(201);
    expect(names).toEqual(["caller", "forever"]);
  });
});
