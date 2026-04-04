import Database from "bun:sqlite";
import { join } from "node:path";

export function openDb(dir: string): Database {
  const db = new Database(join(dir, "archive.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
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
  `);

  // Idempotent migration: add 'kind' to schedules (distinguishes url vs rss_feed schedules).
  try {
    db.exec("ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'url'");
  } catch {
    // Column already exists — safe to ignore.
  }

  // Idempotent migration: add pause/resume and status tracking to schedules.
  try {
    db.exec("ALTER TABLE schedules ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — safe to ignore.
  }
  try {
    db.exec("ALTER TABLE schedules ADD COLUMN last_status TEXT");
  } catch {
    // Column already exists — safe to ignore.
  }
  try {
    db.exec("ALTER TABLE schedules ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — safe to ignore.
  }

  // Idempotent migrations: add per-extractor timing and error tracking to archive_results.
  try {
    db.exec("ALTER TABLE archive_results ADD COLUMN duration_ms INTEGER");
  } catch {
    // Column already exists — safe to ignore.
  }
  try {
    db.exec("ALTER TABLE archive_results ADD COLUMN error TEXT");
  } catch {
    // Column already exists — safe to ignore.
  }

  return db;
}
