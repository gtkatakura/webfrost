/**
 * `webfrost push` / `export` / bundle `import`, end to end: the CLI runs as a subprocess on its
 * own archive and pushes to a WebFrost server running in this process on a separate archive.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilesystemBackend,
  addTagToSnapshot,
  closeDatabases,
  createApiKey,
  createTag,
  openDb,
  recordResult,
  searchSnapshots,
  sql,
} from "@webfrost/core";

import { isLoopbackHost, printable } from "./commands/push";

const CLI = join(import.meta.dir, "index.ts");

let serverDir: string;
let server: { port: number; stop: () => void };
let apiKey: string;
let laptopDir: string;

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: laptopDir,
    env: { ...process.env, WEBFROST_DIR: laptopDir, WEBFROST_API_KEY: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

const VIDEO = new Uint8Array(300_000).map((_, i) => (i * 7919) % 251);

/** A finished video snapshot in the laptop archive. */
async function seedLaptop(): Promise<number> {
  const db = await openDb(laptopDir);
  const storage = new FilesystemBackend(join(laptopDir, "snapshots"));
  try {
    const id = await db.insert(
      sql`INSERT INTO snapshots (url, status, created_at) VALUES ('https://www.youtube.com/watch?v=abc', 'done', '2026-11-01 10:00:00')`,
    );
    await recordResult(db, id, {
      extractor: "readability",
      content: JSON.stringify({ title: "Wombat documentary", textContent: "wombats dig burrows" }),
    });
    const ref = await storage.putBytes(id, "media/media.mp4", VIDEO);
    await recordResult(db, id, { extractor: "media", content: ref, sizeBytes: VIDEO.length });
    const tag = await createTag(db, "talks");
    await addTagToSnapshot(db, id, tag.id);
    return id;
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  serverDir = mkdtempSync(join(tmpdir(), "webfrost-push-server-"));
  process.env.WEBFROST_DIR = serverDir;
  process.env.SESSION_SECRET ??= "push-test-secret-at-least-32-characters";
  const db = await openDb(serverDir);
  try {
    apiKey = (await createApiKey(db, "push")).rawKey;
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
  laptopDir = mkdtempSync(join(tmpdir(), "webfrost-push-laptop-"));
  mkdirSync(laptopDir, { recursive: true });
});

afterEach(() => {
  rmSync(laptopDir, { recursive: true, force: true });
});

describe("webfrost push", () => {
  test("sends a snapshot to the server, which stores it as a new snapshot with its file and tags", async () => {
    const id = await seedLaptop();
    const result = await runCli(
      ["push", String(id), "--to", `http://127.0.0.1:${server.port}`, "--json"],
      {
        WEBFROST_API_KEY: apiKey,
      },
    );
    expect(result.stderr).not.toContain("Error");
    expect(result.exitCode).toBe(0);
    const [outcome] = JSON.parse(result.stdout) as {
      id: number;
      ok: boolean;
      remote: { id: number; status: string; url: string };
    }[];
    expect(outcome?.ok).toBe(true);
    expect(outcome?.remote.status).toBe("done");
    expect(outcome?.remote.url).toBe("https://www.youtube.com/watch?v=abc");

    const db = await openDb(serverDir);
    try {
      const remoteId = outcome?.remote.id as number;
      const media = await db.get<{ content: string }>(
        sql`SELECT content FROM archive_results WHERE snapshot_id = ${remoteId} AND extractor = 'media'`,
      );
      expect(media?.content).toBe(
        join(serverDir, "snapshots", String(remoteId), "media", "media.mp4"),
      );
      expect(
        Buffer.from(await Bun.file(media?.content as string).bytes()).equals(Buffer.from(VIDEO)),
      ).toBe(true);
      const tags = await db.all<{ name: string }>(
        sql`SELECT t.name FROM tags t JOIN snapshot_tags st ON st.tag_id = t.id WHERE st.snapshot_id = ${remoteId}`,
      );
      expect(tags.map((t) => t.name)).toEqual(["talks"]);
      expect((await searchSnapshots(db, "wombats")).items.map((h) => h.id)).toContain(remoteId);
    } finally {
      await db.close();
    }
  });

  test("without WEBFROST_API_KEY it fails before sending anything", async () => {
    const id = await seedLaptop();
    const result = await runCli(["push", String(id), "--to", `http://127.0.0.1:${server.port}`]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("WEBFROST_API_KEY is not set");
  });

  test("a wrong key is reported per snapshot, exit code 1", async () => {
    const id = await seedLaptop();
    const result = await runCli(["push", String(id), "--to", `http://127.0.0.1:${server.port}`], {
      WEBFROST_API_KEY: "wf_not_a_real_key",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("rejected WEBFROST_API_KEY");
  });

  test("an unknown snapshot fails, the others are still sent", async () => {
    const id = await seedLaptop();
    const result = await runCli(
      ["push", "999", String(id), "--to", `http://127.0.0.1:${server.port}`, "--json"],
      {
        WEBFROST_API_KEY: apiKey,
      },
    );
    expect(result.exitCode).toBe(1);
    const outcomes = JSON.parse(result.stdout) as { id: number; ok: boolean; error?: string }[];
    expect(outcomes.map((o) => [o.id, o.ok])).toEqual([
      [999, false],
      [id, true],
    ]);
    expect(outcomes[0]?.error).toContain("not found");
  });

  test("--to is required and must be http(s)", async () => {
    expect((await runCli(["push", "1"], { WEBFROST_API_KEY: apiKey })).exitCode).toBe(2);
    expect(
      (await runCli(["push", "1", "--to", "ftp://x"], { WEBFROST_API_KEY: apiKey })).exitCode,
    ).toBe(2);
  });
});

describe("webfrost push over plain HTTP and hostile server replies", () => {
  test("plain HTTP to another machine is refused without --insecure, before anything is sent", async () => {
    const id = await seedLaptop();
    const result = await runCli(["push", String(id), "--to", "http://192.0.2.10:3000"], {
      WEBFROST_API_KEY: apiKey,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("plain HTTP");
    expect(result.stderr).toContain("--insecure");
  });

  test("loopback names count as this machine; other hosts do not", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.8.9.10", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ["192.168.1.2", "example.com", "localhost.example.com", "128.0.0.1"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  test("control characters in a server's error are not printed to the terminal", async () => {
    const id = await seedLaptop();
    const hostile = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        await req.arrayBuffer();
        return Response.json(
          { error: "\u001b]0;pwned\u0007\u001b[2J\rfake success\u009b31m", code: "VALIDATION" },
          { status: 400 },
        );
      },
    });
    try {
      const result = await runCli(
        ["push", String(id), "--to", `http://127.0.0.1:${hostile.port}`],
        {
          WEBFROST_API_KEY: apiKey,
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("fake success");
      // No control character other than the newlines between log lines.
      const controls = [...result.stderr].filter((c) => {
        const code = c.charCodeAt(0);
        return (code < 0x20 && c !== "\n") || (code >= 0x7f && code <= 0x9f);
      });
      expect(controls).toEqual([]);
    } finally {
      hostile.stop(true);
    }
    expect(printable("a\u001b[31mb\r\nc")).toBe("a [31mb c");
  });
});

describe("webfrost export and import of a bundle", () => {
  test("export writes a bundle that `webfrost import` stores as a new local snapshot", async () => {
    const id = await seedLaptop();
    const out = join(laptopDir, "out.zip");
    const exported = await runCli(["export", String(id), "-o", out, "--json"]);
    expect(exported.exitCode).toBe(0);
    expect(JSON.parse(exported.stdout)).toEqual({ id, path: out, bytes: Bun.file(out).size });
    expect(existsSync(out)).toBe(true);

    const imported = await runCli(["import", out]);
    expect(imported.exitCode).toBe(0);
    expect(imported.stderr + imported.stdout).toContain(`as snapshot ${id + 1} (done)`);
    const db = await openDb(laptopDir);
    try {
      const rows = await db.all<{ id: number; url: string }>(
        sql`SELECT id, url FROM snapshots ORDER BY id`,
      );
      expect(rows).toEqual([
        { id, url: "https://www.youtube.com/watch?v=abc" },
        { id: id + 1, url: "https://www.youtube.com/watch?v=abc" },
      ]);
    } finally {
      await db.close();
    }
  });
});
