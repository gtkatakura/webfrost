import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceAuthStore, deviceAuth, normalizeUserCode } from "../device-auth";

let testDir: string;
let session: string;

/** A server with auth on, an admin and a session cookie for them: the way it runs for real. */
beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `webfrost-device-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
  process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
  Reflect.deleteProperty(process.env, "AUTH_DISABLED");

  const { openDb, createAdminUser, createSession } = await import("@webfrost/core");
  const db = await openDb(testDir);
  await createAdminUser(db, "admin", "password123");
  session = await createSession(db, process.env.SESSION_SECRET, "admin");
  await db.close();
});

afterEach(async () => {
  // Requests of one test must not be found by the next.
  for (const code of pendingCodes.splice(0)) deviceAuth.deny(code);
  const { closeDatabases } = await import("@webfrost/core");
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  Reflect.deleteProperty(process.env, "SESSION_SECRET");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const pendingCodes: string[] = [];

async function getApp() {
  const { authPlugin } = await import("./auth");
  const { deviceRouter } = await import("./device");
  const { settingsRouter } = await import("./settings");
  const { Elysia } = await import("elysia");
  return new Elysia().use(authPlugin).use(deviceRouter).use(settingsRouter);
}

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: boolean; bearer?: string } = {},
): Promise<{ status: number; body: Json }> {
  const app = await getApp();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = `session=${session}`;
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

/** What `webfrost login` does first: no credentials at all. */
async function start(name?: string): Promise<{ deviceCode: string; userCode: string }> {
  const { status, body } = await call("POST", "/auth/device", { body: name ? { name } : {} });
  expect(status).toBe(200);
  pendingCodes.push(body.userCode as string);
  return { deviceCode: body.deviceCode as string, userCode: body.userCode as string };
}

const poll = (deviceCode: string) => call("POST", "/auth/device/token", { body: { deviceCode } });

describe("webfrost login: the connection request", () => {
  test("approved in the web UI, the CLI collects an API key that works", async () => {
    const started = await call("POST", "/auth/device", { body: { name: "CLI on laptop" } });
    expect(started.status).toBe(200);
    const { deviceCode, userCode } = started.body as { deviceCode: string; userCode: string };
    pendingCodes.push(userCode);
    expect(userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(deviceCode).toMatch(/^[0-9a-f]{64}$/);
    expect(started.body).toMatchObject({
      expiresIn: 600,
      interval: 2,
      verificationPath: "/#/connect",
      verificationPathComplete: `/#/connect?code=${userCode}`,
    });

    // Nothing to collect, and no API key exists, until someone approves.
    expect((await poll(deviceCode)).body).toEqual({ status: "pending" });
    const before = await call("GET", "/settings/keys", { cookie: true });
    expect(before.body.total).toBe(0);

    // The signed-in person sees what is asking, then approves.
    const seen = await call("GET", `/auth/device/requests/${userCode}`, { cookie: true });
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ userCode, name: "CLI on laptop", status: "pending" });
    expect(seen.body.deviceCode).toBeUndefined();
    const approved = await call("POST", `/auth/device/requests/${userCode}/approve`, {
      cookie: true,
    });
    expect(approved.status).toBe(200);

    const collected = await poll(deviceCode);
    expect(collected.status).toBe(200);
    expect(collected.body.status).toBe("approved");
    const apiKey = collected.body.apiKey as string;
    expect(apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(collected.body.key).toMatchObject({ name: "CLI on laptop", expiresAt: null });

    // The key is a normal API key: it authenticates, and it is listed (and revocable) in Settings.
    const listed = await call("GET", "/settings/keys", { bearer: apiKey });
    expect(listed.status).toBe(200);
    expect((listed.body.items as Json[]).map((k) => k.name)).toEqual(["CLI on laptop"]);

    // The answer is given once: the device code is worth nothing afterwards.
    expect((await poll(deviceCode)).status).toBe(404);
    expect((await call("GET", `/auth/device/requests/${userCode}`, { cookie: true })).status).toBe(
      404,
    );
    expect((await call("GET", "/settings/keys", { cookie: true })).body.total).toBe(1);
  });

  test("denied, the CLI is told and no key is created", async () => {
    const { deviceCode, userCode } = await start();
    const denied = await call("POST", `/auth/device/requests/${userCode}/deny`, { cookie: true });
    expect(denied.status).toBe(200);

    expect((await poll(deviceCode)).body).toEqual({ status: "denied" });
    expect((await poll(deviceCode)).status).toBe(404);
    expect((await call("GET", "/settings/keys", { cookie: true })).body.total).toBe(0);
  });

  test("the code is accepted as people type it, and an answer cannot be changed", async () => {
    const { userCode } = await start();
    const typed = ` ${userCode.replace("-", " ").toLowerCase()} `;
    const seen = await call("GET", `/auth/device/requests/${encodeURIComponent(typed)}`, {
      cookie: true,
    });
    expect(seen.body.userCode).toBe(userCode);

    expect(
      (await call("POST", `/auth/device/requests/${userCode}/deny`, { cookie: true })).status,
    ).toBe(200);
    expect(
      (await call("POST", `/auth/device/requests/${userCode}/approve`, { cookie: true })).status,
    ).toBe(404);
  });

  test("seeing and answering a request take a signed-in person", async () => {
    const { deviceCode, userCode } = await start();

    // No credentials: the public routes are the CLI's two, nothing else.
    expect((await call("GET", `/auth/device/requests/${userCode}`)).status).toBe(401);
    expect((await call("POST", `/auth/device/requests/${userCode}/approve`)).status).toBe(401);
    expect((await call("POST", `/auth/device/requests/${userCode}/deny`)).status).toBe(401);

    // An API key cannot approve a request and so turn itself into another key.
    const { openDb, createApiKey } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const { rawKey } = await createApiKey(db, "existing");
    await db.close();
    const byKey = await call("POST", `/auth/device/requests/${userCode}/approve`, {
      bearer: rawKey,
    });
    expect(byKey.status).toBe(403);

    expect((await poll(deviceCode)).body).toEqual({ status: "pending" });
  });

  test("an unknown code or decision changes nothing", async () => {
    expect((await poll("0".repeat(64))).status).toBe(404);
    expect((await call("GET", "/auth/device/requests/BCDF-GHJK", { cookie: true })).status).toBe(
      404,
    );
    expect(
      (await call("POST", "/auth/device/requests/BCDF-GHJK/approve", { cookie: true })).status,
    ).toBe(404);
    const { userCode } = await start();
    const other = await call("POST", `/auth/device/requests/${userCode}/revoke`, { cookie: true });
    expect([400, 404, 422]).toContain(other.status);
  });

  test("the name is one line of text, and has a default", async () => {
    const odd = await start("  laptop\n\u001b[31mred\u0000  ");
    const seen = await call("GET", `/auth/device/requests/${odd.userCode}`, { cookie: true });
    expect(seen.body.name).toBe("laptop [31mred");

    const unnamed = await start();
    const second = await call("GET", `/auth/device/requests/${unnamed.userCode}`, {
      cookie: true,
    });
    expect(second.body.name).toBe("webfrost CLI");

    const tooLong = await call("POST", "/auth/device", { body: { name: "x".repeat(101) } });
    expect(tooLong.status).toBe(400);
  });
});

describe("DeviceAuthStore", () => {
  test("a request expires: it cannot be seen, approved or collected afterwards", () => {
    let now = 1_000_000;
    const store = new DeviceAuthStore({ ttlMs: 60_000, now: () => now });
    const started = store.start({ name: "cli", requesterIp: "203.0.113.7" });
    if (!started) throw new Error("no request");
    expect(store.find(started.userCode)?.status).toBe("pending");

    now += 59_999;
    expect(store.collect(started.deviceCode)).toEqual({ status: "pending" });
    now += 1;
    expect(store.find(started.userCode)).toBeNull();
    expect(store.approve(started.userCode)).toBe(false);
    expect(store.collect(started.deviceCode)).toEqual({ status: "unknown" });
    expect(store.size).toBe(0);
  });

  test("an approval that is never collected expires too", () => {
    let now = 0;
    const store = new DeviceAuthStore({ ttlMs: 1000, now: () => now });
    const started = store.start({ name: "cli", requesterIp: "203.0.113.7" });
    if (!started) throw new Error("no request");
    expect(store.approve(started.userCode)).toBe(true);
    now = 1000;
    expect(store.collect(started.deviceCode)).toEqual({ status: "unknown" });
  });

  test("holds a bounded number of requests, and makes room as they expire", () => {
    let now = 0;
    const store = new DeviceAuthStore({ ttlMs: 1000, maxRequests: 3, now: () => now });
    const input = { name: "cli", requesterIp: "203.0.113.7" };
    const codes = new Set<string>();
    for (let i = 0; i < 3; i++) codes.add(store.start(input)?.userCode ?? "");
    expect(codes.size).toBe(3);
    expect(store.start(input)).toBeNull();

    now = 1000;
    expect(store.start(input)).not.toBeNull();
    expect(store.size).toBe(1);
  });

  test("only the hash of the device code is kept", () => {
    const store = new DeviceAuthStore();
    const started = store.start({ name: "cli", requesterIp: "203.0.113.7" });
    if (!started) throw new Error("no request");
    expect(JSON.stringify([...Object.values(store)])).not.toContain(started.deviceCode);
    expect(store.find(started.userCode)).not.toHaveProperty("deviceCodeHash");
  });

  test("normalizeUserCode ignores case, dashes and spaces", () => {
    expect(normalizeUserCode(" wdjb-mjht ")).toBe("WDJBMJHT");
    expect(normalizeUserCode("WDJB MJHT")).toBe("WDJBMJHT");
  });
});
