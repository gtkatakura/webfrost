import Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function columns(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

describe("openDb", () => {
  test("stamps the schema version and waits for competing writers", () => {
    const db = openDb(testDir);
    try {
      const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
      expect(version?.user_version).toBeGreaterThan(0);
      const timeout = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
      expect(timeout?.timeout).toBe(5000);
    } finally {
      db.close();
    }
  });

  test("creates the indexes the hot queries rely on", () => {
    const db = openDb(testDir);
    try {
      const names = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "idx_archive_results_snapshot",
          "idx_snapshots_url",
          "idx_snapshots_status",
          "idx_schedules_next_run",
          "idx_api_keys_hash",
        ]),
      );
    } finally {
      db.close();
    }
  });

  test("upgrades an archive created by an older version in place", () => {
    // The 0.1.0 schema: no schedule kind/pause columns, no extractor timing, no sessions.
    const legacy = new Database(join(testDir, "archive.db"));
    legacy.exec(`
      CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE archive_results (id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), extractor TEXT NOT NULL,
        content TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL,
        cron TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT, next_run_at TEXT NOT NULL);
      INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done');
      INSERT INTO schedules (url, cron, next_run_at) VALUES ('https://example.com', '* * * * *', '2030-01-01 00:00:00');
    `);
    legacy.close();

    const db = openDb(testDir);
    try {
      expect(columns(db, "schedules")).toEqual(
        expect.arrayContaining(["kind", "paused", "last_status", "consecutive_failures"]),
      );
      expect(columns(db, "archive_results")).toEqual(
        expect.arrayContaining(["duration_ms", "error"]),
      );
      expect(columns(db, "sessions")).toContain("expires_at");
      // Existing rows survive and pick up the defaults.
      expect(db.query<{ url: string }, []>("SELECT url FROM snapshots").get()?.url).toBe(
        "https://example.com",
      );
      expect(
        db.query<{ kind: string; paused: number }, []>("SELECT kind, paused FROM schedules").get(),
      ).toEqual({ kind: "url", paused: 0 });
    } finally {
      db.close();
    }
  });

  test("reopening an up-to-date archive does not re-run the migration", () => {
    openDb(testDir).close();
    // If the DDL ran again this dropped index would come back.
    const raw = new Database(join(testDir, "archive.db"));
    raw.exec("DROP INDEX idx_snapshots_url");
    raw.close();

    const db = openDb(testDir);
    try {
      const idx = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_snapshots_url'",
        )
        .get();
      expect(idx).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("openDb under contention", () => {
  test("many processes can open a brand-new archive at the same time", async () => {
    const dbModule = join(import.meta.dir, "db.ts");
    const script = `import { openDb } from ${JSON.stringify(dbModule)}; const db = openDb(${JSON.stringify(testDir)}); db.query("INSERT INTO snapshots (url) VALUES ('https://example.com')").run(); db.close();`;

    const procs = Array.from({ length: 10 }, () =>
      Bun.spawn(["bun", "-e", script], { stdout: "ignore", stderr: "pipe" }),
    );
    const results = await Promise.all(
      procs.map(async (p) => ({
        code: await p.exited,
        stderr: await new Response(p.stderr).text(),
      })),
    );

    expect(results.filter((r) => r.code !== 0).map((r) => r.stderr.slice(0, 200))).toEqual([]);

    const db = openDb(testDir);
    try {
      expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM snapshots").get()?.n).toBe(10);
    } finally {
      db.close();
    }
  }, 60_000);
});
