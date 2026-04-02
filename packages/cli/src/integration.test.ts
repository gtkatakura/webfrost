/**
 * Integration tests for the P1 core pipeline.
 * Covers: init, add URL (success), add URL (partial failure), list.
 *
 * No real network calls — uses a local Bun HTTP mock server for all URL adds.
 *
 * Schema reference (actual tables as implemented in @webfrost/core):
 *   - snapshots        — one row per archived URL
 *   - archive_results  — one row per extractor output (HTML, screenshot, etc.)
 *   - job_queue        — internal job tracking
 *
 * Status values: "done" (success), "failed", "partial"
 */

import Database from "bun:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI = join(import.meta.dir, "index.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd,
    env: { ...process.env, WEBFROST_DIR: cwd },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: exitCode ?? 1, stdout, stderr };
}

function openDb(archiveDir: string): Database {
  const dbPath = join(archiveDir, "archive.db");
  return new Database(dbPath, { readonly: true });
}

/** Start a minimal HTTP server returning a fixture HTML page. */
function startMockServer(handler: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  return server;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `webfrost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// 1. init flow
// ---------------------------------------------------------------------------

describe("init", () => {
  test("creates archive.db with required tables", async () => {
    const result = await runCli(["init"], testDir);

    expect(result.exitCode).toBe(0);

    const db = openDb(testDir);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("snapshots");
    expect(tables).toContain("archive_results");
    expect(tables).toContain("job_queue");

    db.close();
  });

  test("is idempotent — re-running init does not error or corrupt the DB", async () => {
    await runCli(["init"], testDir);
    const second = await runCli(["init"], testDir);

    expect(second.exitCode).toBe(0);

    const db = openDb(testDir);
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    expect(tables).toContain("snapshots");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 2. add URL — success path
// ---------------------------------------------------------------------------

describe("add URL (success)", () => {
  test("records snapshot row with status=done and stores archive_results", async () => {
    await runCli(["init"], testDir);

    const server = startMockServer(
      () =>
        new Response(
          "<html><head><title>Mock Page</title></head><body><p>Hello WebFrost</p></body></html>",
          { headers: { "content-type": "text/html" } },
        ),
    );

    try {
      const url = `http://localhost:${server.port}/page`;
      const result = await runCli(["add", url], testDir);

      expect(result.exitCode).toBe(0);

      const db = openDb(testDir);

      const snapshot = db
        .query<{ url: string; status: string }, []>(
          "SELECT url, status FROM snapshots ORDER BY rowid DESC LIMIT 1",
        )
        .get();

      expect(snapshot).not.toBeNull();
      expect(snapshot?.url).toBe(url);
      expect(snapshot?.status).toBe("done");

      // At least one archive result (HTML extract) should be present
      const results = db
        .query<{ snapshot_id: number }, []>("SELECT snapshot_id FROM archive_results LIMIT 1")
        .all();

      expect(results.length).toBeGreaterThan(0);

      db.close();
    } finally {
      server.stop(true);
    }
  });

  test("adding the same URL twice creates two independent snapshot rows", async () => {
    await runCli(["init"], testDir);

    const server = startMockServer(
      () =>
        new Response("<html><body>dup</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );

    try {
      const url = `http://localhost:${server.port}/dup`;
      await runCli(["add", url], testDir);
      await runCli(["add", url], testDir);

      const db = openDb(testDir);
      const count = db
        .query<{ n: number }, [string]>("SELECT COUNT(*) as n FROM snapshots WHERE url = ?")
        .get(url);

      expect(count?.n).toBe(2);
      db.close();
    } finally {
      server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. add URL — partial failure
// ---------------------------------------------------------------------------

describe("add URL (partial failure)", () => {
  test("unreachable host records snapshot with failed/partial status — no crash", async () => {
    await runCli(["init"], testDir);

    // Use a port that is not bound to anything
    const url = "http://localhost:19999/unreachable";
    const result = await runCli(["add", url], testDir);

    // CLI must exit cleanly — partial failure is not a fatal error
    expect(result.exitCode).toBe(0);

    const db = openDb(testDir);
    const snapshot = db
      .query<{ status: string }, [string]>(
        "SELECT status FROM snapshots WHERE url = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(url);

    expect(snapshot).not.toBeNull();
    if (snapshot) expect(["failed", "partial"]).toContain(snapshot.status);

    // DB integrity: all other tables still accessible
    const tableCheck = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tableCheck).toContain("snapshots");

    db.close();
  });

  test("5xx response records failed/partial status — no crash", async () => {
    await runCli(["init"], testDir);

    const server = startMockServer(() => new Response("Internal Server Error", { status: 500 }));

    try {
      const url = `http://localhost:${server.port}/error`;
      const result = await runCli(["add", url], testDir);

      expect(result.exitCode).toBe(0);

      const db = openDb(testDir);
      const snapshot = db
        .query<{ status: string }, [string]>(
          "SELECT status FROM snapshots WHERE url = ? ORDER BY rowid DESC LIMIT 1",
        )
        .get(url);

      expect(snapshot).not.toBeNull();
      if (snapshot) expect(["failed", "partial"]).toContain(snapshot.status);

      db.close();
    } finally {
      server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. list
// ---------------------------------------------------------------------------

describe("list", () => {
  test("returns all added URLs with expected fields", async () => {
    await runCli(["init"], testDir);

    const server = startMockServer(
      () =>
        new Response("<html><body>list-test</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );

    try {
      const urls = [`http://localhost:${server.port}/a`, `http://localhost:${server.port}/b`];

      for (const url of urls) {
        await runCli(["add", url], testDir);
      }

      const result = await runCli(["list"], testDir);

      expect(result.exitCode).toBe(0);

      for (const url of urls) {
        expect(result.stdout).toContain(url);
      }
    } finally {
      server.stop(true);
    }
  });

  test("list on empty archive exits 0 and produces no error output", async () => {
    await runCli(["init"], testDir);

    const result = await runCli(["list"], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
