/**
 * `webfrost login` / `logout`, end to end: the CLI runs as a subprocess and connects to a WebFrost
 * server running in this process with authentication on. The test plays the person in the web UI:
 * it reads the code the CLI prints and approves (or denies) it with the admin's session.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabases,
  createAdminUser,
  createSession,
  listApiKeys,
  openDb,
  sql,
} from "@webfrost/core";

const CLI = join(import.meta.dir, "index.ts");

let serverDir: string;
let server: { port: number; stop: () => void };
let session: string;
let home: string;

const origin = () => `http://127.0.0.1:${server.port}`;
const credentialsFile = () => join(home, "config", "webfrost", "credentials.json");

function spawnCli(args: string[], env: Record<string, string | undefined> = {}) {
  return Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: home,
    env: {
      ...process.env,
      WEBFROST_DIR: join(home, "archive"),
      WEBFROST_API_KEY: undefined,
      XDG_CONFIG_HOME: join(home, "config"),
      // Never open a real browser from a test, whatever the flags.
      DISPLAY: undefined,
      WAYLAND_DISPLAY: undefined,
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const proc = spawnCli(args, env);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * Start `webfrost login` and read what it prints until the code appears. `finish()` waits for it
 * to end and returns everything it printed.
 */
async function startLogin(args: string[] = []) {
  const proc = spawnCli(["login", origin(), "--no-browser", ...args]);
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let stderr = "";
  let userCode: string | undefined;
  while (!userCode) {
    const { value, done } = await reader.read();
    if (done) break;
    stderr += decoder.decode(value, { stream: true });
    userCode = /^ {2}([A-Z]{4}-[A-Z]{4})$/m.exec(stderr)?.[1];
  }
  if (!userCode) throw new Error(`webfrost login printed no code:\n${stderr}`);
  return {
    userCode,
    printed: () => stderr,
    async finish() {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      return { exitCode, stdout, stderr };
    },
  };
}

/** The person in the web UI: signed in, they answer the request that shows this code. */
async function answer(userCode: string, decision: "approve" | "deny"): Promise<number> {
  const res = await fetch(`${origin()}/api/v1/auth/device/requests/${userCode}/${decision}`, {
    method: "POST",
    headers: { cookie: `session=${session}` },
  });
  return res.status;
}

async function keysOnServer() {
  const db = await openDb(serverDir);
  try {
    return await listApiKeys(db);
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  serverDir = mkdtempSync(join(tmpdir(), "webfrost-login-server-"));
  process.env.WEBFROST_DIR = serverDir;
  process.env.SESSION_SECRET ??= "login-test-secret-at-least-32-characters";
  Reflect.deleteProperty(process.env, "AUTH_DISABLED");
  const db = await openDb(serverDir);
  try {
    await createAdminUser(db, "admin", "password123");
    session = await createSession(db, process.env.SESSION_SECRET, "admin");
  } finally {
    await db.close();
  }
  const { app } = await import("@webfrost/server");
  const listening = app.listen({ port: 0, hostname: "127.0.0.1" });
  server = { port: listening.server?.port ?? 0, stop: () => void app.stop() };
});

afterAll(async () => {
  server.stop();
  await closeDatabases();
  rmSync(serverDir, { recursive: true, force: true });
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "webfrost-login-home-"));
});

afterEach(async () => {
  rmSync(home, { recursive: true, force: true });
  const db = await openDb(serverDir);
  try {
    await db.run(sql`DELETE FROM api_keys`);
  } finally {
    await db.close();
  }
});

describe("webfrost login", () => {
  test("approved in the web UI: a key is created, saved privately and used by other commands", async () => {
    const login = await startLogin(["--name", "test laptop"]);
    expect(login.printed()).toContain(`${origin()}/#/connect?code=${login.userCode}`);
    // Until the approval there is no key, on the server or here.
    expect(await keysOnServer()).toHaveLength(0);
    expect(existsSync(credentialsFile())).toBe(false);

    expect(await answer(login.userCode, "approve")).toBe(200);
    const done = await login.finish();
    expect(done.stdout).toContain(`Connected to ${origin()}`);
    expect(done.exitCode).toBe(0);

    const keys = await keysOnServer();
    expect(keys.map((k) => k.name)).toEqual(["test laptop"]);

    // Saved for this server only, in a file nobody else can read.
    expect(statSync(credentialsFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "config", "webfrost")).mode & 0o777).toBe(0o700);
    const saved = JSON.parse(readFileSync(credentialsFile(), "utf8")) as {
      servers: Record<string, { apiKey: string; keyId: string; name: string }>;
    };
    expect(Object.keys(saved.servers)).toEqual([origin()]);
    expect(saved.servers[origin()]).toMatchObject({ keyId: keys[0]?.id, name: "test laptop" });
    // The key never appears in what the command prints.
    const apiKey = saved.servers[origin()]?.apiKey ?? "";
    expect(apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(done.stderr + done.stdout).not.toContain(apiKey);

    // Another command reaches the server with it, with no WEBFROST_API_KEY.
    const rescue = await runCli(["rescue", "blocked", "--from", origin(), "--dry-run", "--json"]);
    expect(rescue.stderr).not.toContain("No API key");
    expect(rescue.exitCode).toBe(0);
    expect((await keysOnServer())[0]?.lastUsedAt).not.toBeNull();
  }, 30_000);

  test("denied in the web UI: the command fails and nothing is saved or created", async () => {
    const login = await startLogin();
    expect(await answer(login.userCode, "deny")).toBe(200);
    const done = await login.finish();
    expect(done.exitCode).toBe(1);
    expect(done.stderr).toContain("denied");
    expect(existsSync(credentialsFile())).toBe(false);
    expect(await keysOnServer()).toHaveLength(0);
  }, 30_000);

  test("--json prints where the key went, never the key", async () => {
    const login = await startLogin(["--json"]);
    expect(await answer(login.userCode, "approve")).toBe(200);
    const done = await login.finish();
    expect(done.exitCode).toBe(0);
    const out = JSON.parse(done.stdout) as { server: string; key: { name: string }; file: string };
    expect(out.server).toBe(origin());
    expect(out.file).toBe(credentialsFile());
    expect(out.key.name).toMatch(/^webfrost CLI on /);
    expect(Object.keys(out.key).sort()).toEqual(["id", "name"]);
  }, 30_000);

  test("a server without the feature, or behind a sign-in wall, gets a message that says what to do", async () => {
    const old = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) =>
        new URL(req.url).pathname.startsWith("/walled")
          ? new Response(null, { status: 302, headers: { location: "https://sso.example/login" } })
          : new Response(JSON.stringify({ error: "not found", code: "NOT_FOUND" }), {
              status: 404,
            }),
    });
    try {
      const missing = await runCli(["login", `http://127.0.0.1:${old.port}`, "--no-browser"]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("does not offer webfrost login");
      expect(missing.stderr).toContain("WEBFROST_API_KEY");

      const walled = await runCli(["login", `http://127.0.0.1:${old.port}/walled`, "--no-browser"]);
      expect(walled.exitCode).toBe(1);
      expect(walled.stderr).toContain("redirect");
      expect(walled.stderr).toContain("/api/");
    } finally {
      old.stop(true);
    }
    expect(existsSync(credentialsFile())).toBe(false);
  }, 30_000);

  test("usage errors: no server, not a URL, plain HTTP to another machine", async () => {
    expect((await runCli(["login"])).exitCode).toBe(2);
    expect((await runCli(["login", "archive.example.com"])).exitCode).toBe(2);
    const plain = await runCli(["login", "http://archive.example.com", "--no-browser"]);
    expect(plain.exitCode).toBe(2);
    expect(plain.stderr).toContain("plain HTTP");
  }, 30_000);
});

describe("webfrost logout", () => {
  test("revokes the key on the server and forgets it here", async () => {
    const login = await startLogin();
    await answer(login.userCode, "approve");
    expect((await login.finish()).exitCode).toBe(0);
    const saved = JSON.parse(readFileSync(credentialsFile(), "utf8")) as {
      servers: Record<string, { apiKey: string }>;
    };
    const apiKey = saved.servers[origin()]?.apiKey ?? "";

    const out = await runCli(["logout", origin()]);
    expect(out.stdout).toContain("revoked");
    expect(out.exitCode).toBe(0);

    expect(await keysOnServer()).toHaveLength(0);
    const after = await fetch(`${origin()}/api/v1/settings/keys`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(after.status).toBe(401);
    expect(JSON.parse(readFileSync(credentialsFile(), "utf8"))).toEqual({ servers: {} });

    // The commands that need the key say how to get one again.
    const rescue = await runCli(["rescue", "blocked", "--from", origin(), "--dry-run"]);
    expect(rescue.exitCode).toBe(1);
    expect(rescue.stderr).toContain(`webfrost login ${origin()}`);
  }, 30_000);

  test("with nothing saved for the server it says so", async () => {
    const out = await runCli(["logout", origin()]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("No saved API key");
  }, 30_000);

  test("when the server cannot be reached the key is forgotten here and the command says it still works there", async () => {
    const login = await startLogin();
    await answer(login.userCode, "approve");
    expect((await login.finish()).exitCode).toBe(0);

    // The same origin, with nothing listening: rewrite the saved entry to a dead port.
    const dead = "http://127.0.0.1:9";
    const file = JSON.parse(readFileSync(credentialsFile(), "utf8")) as {
      servers: Record<string, unknown>;
    };
    await Bun.write(
      credentialsFile(),
      JSON.stringify({ servers: { [dead]: file.servers[origin()] } }),
    );

    const out = await runCli(["logout", dead]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("still works there");
    expect(JSON.parse(readFileSync(credentialsFile(), "utf8"))).toEqual({ servers: {} });
    expect(await keysOnServer()).toHaveLength(1);
  }, 30_000);
});
