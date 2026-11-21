import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;
let savedAuthDisabled: string | undefined;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
  process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
  savedAuthDisabled = process.env.AUTH_DISABLED;
  Reflect.deleteProperty(process.env, "AUTH_DISABLED");
});

afterEach(() => {
  for (const name of ["WEBFROST_DIR", "SESSION_SECRET", "WEBFROST_SETUP_TOKEN"]) {
    Reflect.deleteProperty(process.env, name);
  }
  if (savedAuthDisabled !== undefined) process.env.AUTH_DISABLED = savedAuthDisabled;
  rmSync(testDir, { recursive: true, force: true });
});

async function getApp() {
  const { setupRouter } = await import("./setup");
  const { Elysia } = await import("elysia");
  return new Elysia().use(setupRouter);
}

function setupRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/setup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const ADMIN = { username: "admin", password: "password123" };

describe("POST /setup without WEBFROST_SETUP_TOKEN", () => {
  test("creates the admin and returns an API key", async () => {
    const res = await (await getApp()).handle(setupRequest(ADMIN));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { apiKey: string }).apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test("status reports that no token is needed", async () => {
    const res = await (await getApp()).handle(new Request("http://localhost/setup/status"));
    expect(await res.json()).toEqual({
      needsSetup: true,
      publicRead: false,
      setupTokenRequired: false,
    });
  });

  test("rejects an over-long password with a JSON validation error", async () => {
    const res = await (await getApp()).handle(
      setupRequest({ username: "admin", password: "x".repeat(1025) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });
});

describe("POST /setup with WEBFROST_SETUP_TOKEN", () => {
  beforeEach(() => {
    process.env.WEBFROST_SETUP_TOKEN = "s3cret-setup-token";
  });

  test("status tells the UI to ask for the token", async () => {
    const res = await (await getApp()).handle(new Request("http://localhost/setup/status"));
    expect(((await res.json()) as { setupTokenRequired: boolean }).setupTokenRequired).toBe(true);
  });

  test("refuses setup without the token and creates nothing", async () => {
    const app = await getApp();
    const res = await app.handle(setupRequest(ADMIN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "invalid setup token",
      code: "SETUP_TOKEN_INVALID",
    });
    const status = await app.handle(new Request("http://localhost/setup/status"));
    expect(((await status.json()) as { needsSetup: boolean }).needsSetup).toBe(true);
  });

  test("refuses a wrong token", async () => {
    const res = await (await getApp()).handle(setupRequest({ ...ADMIN, setupToken: "guess" }));
    expect(res.status).toBe(403);
  });

  test("accepts the token in the body", async () => {
    const res = await (await getApp()).handle(
      setupRequest({ ...ADMIN, setupToken: "s3cret-setup-token" }),
    );
    expect(res.status).toBe(200);
  });

  test("accepts the token in the X-Setup-Token header", async () => {
    const res = await (await getApp()).handle(
      setupRequest(ADMIN, { "x-setup-token": "s3cret-setup-token" }),
    );
    expect(res.status).toBe(200);
  });
});
