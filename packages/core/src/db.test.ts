import Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { SCHEMA_VERSION } from "./database/migrations";
import {
  isTransientError,
  isUniqueViolation,
  openDb,
  parseDatabaseUrl,
  resolveDatabaseConfig,
} from "./db";
import { searchSnapshots } from "./search";
import { getSnapshot } from "./snapshot";
import { getStats } from "./stats";
import { createStorageBackend } from "./storage";
import { isSqliteRun } from "./test-utils";

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

/** Read the archive file directly, outside the data layer. */
function withRaw<T>(fn: (db: Database) => T): T {
  const raw = new Database(join(testDir, "archive.db"));
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}

describe("database selection", () => {
  test("defaults to SQLite at <dir>/archive.db", () => {
    expect(resolveDatabaseConfig("/data", {})).toEqual({
      dialect: "sqlite",
      path: "/data/archive.db",
    });
  });

  test("DATABASE_URL picks the engine", () => {
    expect(resolveDatabaseConfig("/data", { DATABASE_URL: "postgres://u:p@db/webfrost" })).toEqual({
      dialect: "postgres",
      url: "postgres://u:p@db/webfrost",
    });
    expect(parseDatabaseUrl("postgresql://db/x", "/data").dialect).toBe("postgres");
    expect(parseDatabaseUrl("mysql://u:p@db:3306/webfrost", "/data")).toEqual({
      dialect: "mysql",
      url: "mysql://u:p@db:3306/webfrost",
    });
  });

  test("SQLite URLs and paths resolve against the archive directory", () => {
    expect(parseDatabaseUrl("sqlite:///var/lib/wf.db", "/data")).toEqual({
      dialect: "sqlite",
      path: "/var/lib/wf.db",
    });
    expect(parseDatabaseUrl("sqlite://other.db", "/data")).toEqual({
      dialect: "sqlite",
      path: "/data/other.db",
    });
    expect(parseDatabaseUrl("file:x.db", "/data")).toEqual({
      dialect: "sqlite",
      path: "/data/x.db",
    });
    expect(parseDatabaseUrl("/srv/archive.db", "/data")).toEqual({
      dialect: "sqlite",
      path: "/srv/archive.db",
    });
  });

  test("an unknown scheme is an error, not a file name", () => {
    expect(() => parseDatabaseUrl("mongodb://db/x", "/data")).toThrow(/Unsupported/);
  });

  test("a test database URL wins and isolates every directory", () => {
    const env = {
      WEBFROST_TEST_DATABASE_URL: "postgres://u:p@db/webfrost",
      DATABASE_URL: "mysql://elsewhere/x",
    };
    const a = resolveDatabaseConfig("/tmp/a", env);
    const b = resolveDatabaseConfig("/tmp/b", env);
    expect(a.dialect).toBe("postgres");
    expect(a).not.toEqual(b);
    expect(resolveDatabaseConfig("/tmp/a", env)).toEqual(a);
  });
});

describe("error classification", () => {
  test("recognises lock and uniqueness errors from each driver", () => {
    expect(isTransientError(new Error("database is locked"))).toBe(true);
    expect(isTransientError({ code: "40P01" })).toBe(true);
    expect(isTransientError({ errno: 1213 })).toBe(true);
    expect(isTransientError(new Error("syntax error"))).toBe(false);
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: tags.slug"))).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
  });
});

describe("openDb (every dialect)", () => {
  test("applies the schema and accepts portable queries", async () => {
    const db = await openDb(testDir);
    try {
      const id = await db.insert(sql`INSERT INTO snapshots (url) VALUES ('https://example.com')`);
      const row = await db.get<{ status: string; created_at: string }>(
        sql`SELECT status, created_at FROM snapshots WHERE id = ${id}`,
      );
      expect(row?.status).toBe("pending");
      // UTC "YYYY-MM-DD HH:MM:SS" on every database.
      expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`)).toBe(1);
      // A matched row whose value does not change still counts (MySQL reports matched rows).
      expect(await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`)).toBe(1);
    } finally {
      await db.close();
    }
  });

  test("snapshots.color_scheme exists and round-trips on every database", async () => {
    const db = await openDb(testDir);
    try {
      const id = await db.insert(
        sql`INSERT INTO snapshots (url, color_scheme) VALUES ('https://example.com', 'dark')`,
      );
      const row = await db.get<{ color_scheme: string | null }>(
        sql`SELECT color_scheme FROM snapshots WHERE id = ${id}`,
      );
      expect(row?.color_scheme).toBe("dark");
    } finally {
      await db.close();
    }
  });

  test("a failed transaction leaves nothing behind", async () => {
    const db = await openDb(testDir);
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.run(sql`INSERT INTO snapshots (url) VALUES ('https://rolled-back.example')`);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const n = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`);
      expect(Number(n?.n)).toBe(0);
    } finally {
      await db.close();
    }
  });

  test("the database clock helpers agree with each other", async () => {
    const db = await openDb(testDir);
    try {
      const row = await db.get<{ now: string; ago: string; today: string }>(
        sql`SELECT ${db.now()} AS now, ${db.ago(3600)} AS ago, ${db.today()} AS today`,
      );
      expect((row?.ago ?? "~") < (row?.now ?? "")).toBe(true);
      expect(row?.now.startsWith(row?.today ?? "-")).toBe(true);
      const skew = Math.abs(Date.parse(`${row?.now.replace(" ", "T")}Z`) - Date.now());
      expect(skew).toBeLessThan(60_000);
    } finally {
      await db.close();
    }
  });
});

describe.skipIf(!isSqliteRun)("openDb (SQLite archive file)", () => {
  test("stamps the schema version and waits for competing writers", async () => {
    const db = await openDb(testDir);
    try {
      const version = await db.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(version?.user_version).toBe(SCHEMA_VERSION);
      const timeout = await db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`);
      expect(timeout?.timeout).toBe(5000);
      // WAL (and no manual checkpoints) is what keeps the archive Litestream-compatible.
      const mode = await db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
      expect(mode?.journal_mode).toBe("wal");
      const fk = await db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
      expect(fk?.foreign_keys).toBe(1);
    } finally {
      await db.close();
    }
  });

  test("creates the indexes the hot queries rely on", async () => {
    await (await openDb(testDir)).close();
    const names = withRaw((raw) =>
      raw
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_archive_results_snapshot",
        "idx_snapshots_url",
        "idx_snapshots_status",
        "idx_schedules_next_run",
        "idx_api_keys_hash",
        "idx_job_queue_lease",
      ]),
    );
  });

  test("upgrades an archive created by an older version in place", async () => {
    // The 0.1.0 schema: no schedule kind/pause columns, no extractor timing, no sessions.
    withRaw((legacy) =>
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
      `),
    );

    const db = await openDb(testDir);
    await db.close();
    withRaw((raw) => {
      expect(columns(raw, "schedules")).toEqual(
        expect.arrayContaining(["kind", "paused", "last_status", "consecutive_failures"]),
      );
      expect(columns(raw, "archive_results")).toEqual(
        expect.arrayContaining(["duration_ms", "error", "size_bytes"]),
      );
      expect(columns(raw, "job_queue")).toEqual(expect.arrayContaining(["lease_token"]));
      expect(columns(raw, "sessions")).toContain("expires_at");
      // Existing rows survive and pick up the defaults.
      expect(raw.query<{ url: string }, []>("SELECT url FROM snapshots").get()?.url).toBe(
        "https://example.com",
      );
      expect(
        raw.query<{ kind: string; paused: number }, []>("SELECT kind, paused FROM schedules").get(),
      ).toEqual({ kind: "url", paused: 0 });
    });
  });

  test("upgrades a schema-version-2 archive (the pre-multi-database release) without data loss", async () => {
    // Byte-for-byte the DDL the previous release ran, followed by real-looking data.
    withRaw((legacy) => {
      legacy.exec(V2_SCHEMA);
      legacy.exec("PRAGMA user_version = 2;");
      legacy.exec(`
        INSERT INTO snapshots (id, url, status, created_at) VALUES
          (1, 'https://example.com/post', 'done', '2025-01-02 03:04:05'),
          (2, 'https://example.org/other', 'pending', '2025-01-03 00:00:00');
        INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms) VALUES
          (1, 'html', '<html>héllo</html>', 12),
          (1, 'readability', '{"title":"Glacier post","textContent":"about glaciers"}', 30),
          (1, 'screenshot', '${join(testDir, "snapshots", "1", "screenshot.png")}', 99);
        INSERT INTO archive_results (snapshot_id, extractor, error, duration_ms) VALUES
          (1, 'pdf', 'browser unavailable', 5);
        INSERT INTO job_queue (snapshot_id, status, heartbeat_at, attempts) VALUES
          (1, 'done', '2025-01-02 03:04:05', 0), (2, 'pending', '2025-01-03 00:00:00', 1);
        INSERT INTO tags (name, slug) VALUES ('Ice', 'ice');
        INSERT INTO snapshot_tags (snapshot_id, tag_id) VALUES (1, 1);
        INSERT INTO snapshots_fts (rowid, url, title, text_content, tags)
          VALUES (1, 'https://example.com/post', 'Glacier post', 'about glaciers', 'Ice');
        INSERT INTO schedules (url, cron, next_run_at, kind, paused) VALUES
          ('https://example.com/feed', '0 * * * *', '2030-01-01 00:00:00', 'rss_feed', 1);
        INSERT INTO admin_users (username, password_hash) VALUES ('admin', 'hash');
        INSERT INTO api_keys (id, name, key_hash) VALUES ('k1', 'ci', 'abc');
        INSERT INTO sessions (id, username, expires_at) VALUES ('s1', 'admin', '2030-01-01T00:00:00.000Z');
        INSERT INTO imports (id, format, queued, skipped) VALUES ('i1', 'rss', 3, 1);
      `);
    });
    mkdirSync(join(testDir, "snapshots", "1"), { recursive: true });
    await Bun.write(join(testDir, "snapshots", "1", "screenshot.png"), new Uint8Array(1234));

    const db = await openDb(testDir);
    try {
      expect((await db.get<{ user_version: number }>(sql`PRAGMA user_version`))?.user_version).toBe(
        SCHEMA_VERSION,
      );

      const counts = await db.get<Record<string, number>>(
        sql`SELECT
              (SELECT COUNT(*) FROM snapshots) AS snapshots,
              (SELECT COUNT(*) FROM archive_results) AS results,
              (SELECT COUNT(*) FROM job_queue) AS jobs,
              (SELECT COUNT(*) FROM snapshot_tags) AS tagged,
              (SELECT COUNT(*) FROM schedules) AS schedules,
              (SELECT COUNT(*) FROM admin_users) AS admins,
              (SELECT COUNT(*) FROM api_keys) AS api_keys,
              (SELECT COUNT(*) FROM sessions) AS sessions,
              (SELECT COUNT(*) FROM imports) AS imports`,
      );
      expect(counts).toEqual({
        snapshots: 2,
        results: 4,
        jobs: 2,
        tagged: 1,
        schedules: 1,
        admins: 1,
        api_keys: 1,
        sessions: 1,
        imports: 1,
      });

      // Inline results were measured by the migration (bytes, not characters)...
      const sizes = await db.all<{ extractor: string; size_bytes: number | null }>(
        sql`SELECT extractor, size_bytes FROM archive_results ORDER BY id`,
      );
      expect(sizes).toEqual([
        { extractor: "html", size_bytes: Buffer.byteLength("<html>héllo</html>") },
        {
          extractor: "readability",
          size_bytes: Buffer.byteLength('{"title":"Glacier post","textContent":"about glaciers"}'),
        },
        { extractor: "screenshot", size_bytes: null },
        { extractor: "pdf", size_bytes: null },
      ]);

      // ...file-backed ones the first time stats need them, and stored from then on.
      // Two requests at once: storage is asked about each file once, not once per request.
      const real = createStorageBackend(testDir);
      let asked = 0;
      const counting = Object.create(real) as typeof real;
      counting.fileSize = async (ref: string) => {
        asked++;
        await Bun.sleep(20);
        return real.fileSize(ref);
      };
      const [stats] = await Promise.all([getStats(db, counting), getStats(db, counting)]);
      // One file-backed row is unmeasured here: asked once, though two requests needed it.
      expect(asked).toBe(1);
      expect(stats.storageByExtractor.screenshot).toBe(1234);
      const detail = await getSnapshot(db, 1);
      expect(detail?.archiveResults.find((r) => r.extractor === "screenshot")?.size_bytes).toBe(
        1234,
      );

      // The existing full-text index keeps working, tags included.
      expect((await searchSnapshots(db, "glaciers")).items.map((r) => r.id)).toEqual([1]);
      expect((await searchSnapshots(db, "ice")).items.map((r) => r.id)).toEqual([1]);
      const schedule = await db.get<{ kind: string; paused: number }>(
        sql`SELECT kind, paused FROM schedules`,
      );
      expect(schedule).toEqual({ kind: "rss_feed", paused: 1 });
    } finally {
      await db.close();
    }
  });

  test("upgrades a schema-version-3 archive: color_scheme is added, rows keep NULL", async () => {
    await (await openDb(testDir)).close();
    // Put the file back to what the previous release left: no column, version 3.
    withRaw((raw) => {
      raw.exec("INSERT INTO snapshots (url) VALUES ('https://example.com/old')");
      raw.exec("ALTER TABLE snapshots DROP COLUMN color_scheme");
      raw.exec("PRAGMA user_version = 3");
    });
    expect(withRaw((raw) => columns(raw, "snapshots"))).not.toContain("color_scheme");

    const db = await openDb(testDir);
    try {
      expect((await db.get<{ user_version: number }>(sql`PRAGMA user_version`))?.user_version).toBe(
        SCHEMA_VERSION,
      );
      expect(SCHEMA_VERSION).toBe(6);
      expect(
        (await db.get<{ color_scheme: string | null }>(sql`SELECT color_scheme FROM snapshots`))
          ?.color_scheme,
      ).toBeNull();
    } finally {
      await db.close();
    }
  });

  test("upgrades a schema-version-4 archive: failure columns and dead_hosts are added", async () => {
    await (await openDb(testDir)).close();
    // Put the file back to what 0.2 left: no failure columns, no dead_hosts, version 4.
    withRaw((raw) => {
      raw.exec("INSERT INTO snapshots (url, status) VALUES ('https://example.com/old', 'failed')");
      raw.exec("DROP INDEX idx_snapshots_failure");
      raw.exec("ALTER TABLE snapshots DROP COLUMN failure_category");
      raw.exec("ALTER TABLE snapshots DROP COLUMN failure_detail");
      raw.exec("DROP TABLE dead_hosts");
      raw.exec("PRAGMA user_version = 4");
    });

    const db = await openDb(testDir);
    try {
      expect((await db.get<{ user_version: number }>(sql`PRAGMA user_version`))?.user_version).toBe(
        SCHEMA_VERSION,
      );
      // An old failure has no reason: NULL, not a made-up one.
      expect(await db.get(sql`SELECT failure_category, failure_detail FROM snapshots`)).toEqual({
        failure_category: null,
        failure_detail: null,
      });
      expect(await db.all(sql`SELECT host FROM dead_hosts`)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("upgrades a schema-version-5 archive: trashed_at and app_settings are added", async () => {
    await (await openDb(testDir)).close();
    withRaw((raw) => {
      raw.exec("INSERT INTO snapshots (url, status) VALUES ('https://example.com/old', 'done')");
      raw.exec("DROP INDEX idx_snapshots_trashed");
      raw.exec("ALTER TABLE snapshots DROP COLUMN trashed_at");
      raw.exec("DROP TABLE app_settings");
      raw.exec("PRAGMA user_version = 5");
    });

    const db = await openDb(testDir);
    try {
      expect((await db.get<{ user_version: number }>(sql`PRAGMA user_version`))?.user_version).toBe(
        SCHEMA_VERSION,
      );
      // Nothing was in the trash before.
      expect(await db.get(sql`SELECT trashed_at FROM snapshots`)).toEqual({ trashed_at: null });
      expect(await db.all(sql`SELECT name FROM app_settings`)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("reopening an up-to-date archive does not re-run the migration", async () => {
    await (await openDb(testDir)).close();
    // If the DDL ran again this dropped index would come back.
    withRaw((raw) => raw.exec("DROP INDEX idx_snapshots_url"));

    await (await openDb(testDir)).close();
    const idx = withRaw((raw) =>
      raw
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_snapshots_url'",
        )
        .get(),
    );
    expect(idx).toBeNull();
  });

  test("many processes can open a brand-new archive at the same time", async () => {
    const dbModule = join(import.meta.dir, "db.ts");
    const script = `import { openDb } from ${JSON.stringify(dbModule)}; import { sql } from "kysely"; const db = await openDb(${JSON.stringify(testDir)}); await db.run(sql\`INSERT INTO snapshots (url) VALUES ('https://example.com')\`); await db.close();`;

    const procs = Array.from({ length: 10 }, () =>
      Bun.spawn(["bun", "-e", script], {
        cwd: import.meta.dir,
        stdout: "ignore",
        stderr: "pipe",
      }),
    );
    const results = await Promise.all(
      procs.map(async (p) => ({
        code: await p.exited,
        stderr: await new Response(p.stderr).text(),
      })),
    );

    expect(results.filter((r) => r.code !== 0).map((r) => r.stderr.slice(0, 200))).toEqual([]);

    const db = await openDb(testDir);
    try {
      expect((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`))?.n).toBe(10);
    } finally {
      await db.close();
    }
  }, 60_000);
});

/** The schema exactly as the release before multi-database support created it (user_version 2). */
const V2_SCHEMA = `
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS archive_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    extractor TEXT NOT NULL,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    cron TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_run_at TEXT,
    next_run_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS snapshot_tags (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, tag_id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS snapshots_fts USING fts5(url, title, text_content, tags);
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    source_url TEXT,
    format TEXT NOT NULL,
    queued INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'url';
  ALTER TABLE schedules ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE schedules ADD COLUMN last_status TEXT;
  ALTER TABLE schedules ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE archive_results ADD COLUMN duration_ms INTEGER;
  ALTER TABLE archive_results ADD COLUMN error TEXT;
  ALTER TABLE job_queue ADD COLUMN heartbeat_at TEXT;
  ALTER TABLE job_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_archive_results_snapshot ON archive_results (snapshot_id, extractor);
  CREATE INDEX IF NOT EXISTS idx_job_queue_snapshot ON job_queue (snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots (url);
  CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots (status);
  CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots (created_at);
  CREATE INDEX IF NOT EXISTS idx_snapshot_tags_tag ON snapshot_tags (tag_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
`;
