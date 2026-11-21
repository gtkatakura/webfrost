import Database from "bun:sqlite";
import { join } from "node:path";

/**
 * Current schema version, stored in `PRAGMA user_version`.
 * Bump it whenever `migrate()` gains a step so existing archives pick it up.
 */
const SCHEMA_VERSION = 2;

/** How many times to retry opening an archive that another process holds locked. */
const OPEN_RETRIES = 60;

/** Run `sql`, ignoring the "duplicate column" error an already-migrated archive raises. */
function addColumn(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
  }
}

function migrate(db: Database): void {
  db.exec(`
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
    CREATE VIRTUAL TABLE IF NOT EXISTS snapshots_fts USING fts5(
      url,
      title,
      text_content,
      tags
    );
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
  `);

  // 'kind' distinguishes url vs rss_feed schedules.
  addColumn(db, "ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'url'");
  // Pause/resume and status tracking for schedules.
  addColumn(db, "ALTER TABLE schedules ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE schedules ADD COLUMN last_status TEXT");
  addColumn(db, "ALTER TABLE schedules ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0");
  // Per-extractor timing and error tracking.
  addColumn(db, "ALTER TABLE archive_results ADD COLUMN duration_ms INTEGER");
  addColumn(db, "ALTER TABLE archive_results ADD COLUMN error TEXT");
  // Job lease: a live pipeline keeps heartbeat_at fresh so another process does not
  // mistake its snapshot for an orphan; attempts caps how often a job is re-queued.
  addColumn(db, "ALTER TABLE job_queue ADD COLUMN heartbeat_at TEXT");
  addColumn(db, "ALTER TABLE job_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_archive_results_snapshot
      ON archive_results (snapshot_id, extractor);
    CREATE INDEX IF NOT EXISTS idx_job_queue_snapshot ON job_queue (snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots (url);
    CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots (status);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots (created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshot_tags_tag ON snapshot_tags (tag_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
  `);
}

function schemaVersion(db: Database): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

function isLocked(err: unknown): boolean {
  return err instanceof Error && /database is locked|SQLITE_BUSY/i.test(err.message);
}

function open(dir: string): Database {
  const db = new Database(join(dir, "archive.db"));
  try {
    // Wait for a competing writer instead of failing with SQLITE_BUSY: the server,
    // background pipelines and the CLI all open their own connections.
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    // The schema is applied once per archive, not on every connection: the server
    // opens a connection per request, and re-running the DDL there is pure overhead.
    if (schemaVersion(db) < SCHEMA_VERSION) {
      // One writer at a time: take the write lock, then look again — another
      // process may have finished the migration while this one was waiting.
      db.exec("BEGIN IMMEDIATE;");
      try {
        if (schemaVersion(db) < SCHEMA_VERSION) {
          migrate(db);
          db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
        }
        db.exec("COMMIT;");
      } catch (err) {
        db.exec("ROLLBACK;");
        throw err;
      }
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

export function openDb(dir: string): Database {
  // Several processes opening a brand-new archive at once (server + CLI, parallel
  // CLI runs) collide on the switch to WAL and on the first migration, and SQLite
  // reports that as "database is locked" without consulting busy_timeout. Retry.
  for (let attempt = 0; ; attempt++) {
    try {
      return open(dir);
    } catch (err) {
      if (!isLocked(err) || attempt >= OPEN_RETRIES) throw err;
      Bun.sleepSync(10 + Math.min(attempt, 10) * 10);
    }
  }
}
