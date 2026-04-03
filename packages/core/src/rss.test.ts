import Database from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { openDb } from "./db";
import { isUrlArchived } from "./rss";
import { addRssFeedSchedule, addSchedule, listSchedules } from "./schedules";

function makeDb() {
  // In-memory SQLite database for testing
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Create tables manually by going through openDb's init logic
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
      kind TEXT NOT NULL DEFAULT 'url',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("isUrlArchived", () => {
  test("returns false when no snapshots exist", () => {
    const db = makeDb();
    expect(isUrlArchived(db, "https://example.com")).toBe(false);
    db.close();
  });

  test("returns true when the exact URL is archived", () => {
    const db = makeDb();
    db.exec("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')");
    expect(isUrlArchived(db, "https://example.com")).toBe(true);
    db.close();
  });

  test("returns false for a different URL", () => {
    const db = makeDb();
    db.exec("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')");
    expect(isUrlArchived(db, "https://other.com")).toBe(false);
    db.close();
  });
});

describe("addRssFeedSchedule", () => {
  test("creates a schedule with kind=rss_feed", () => {
    const db = makeDb();
    const id = addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s).toBeDefined();
    expect(s?.kind).toBe("rss_feed");
    expect(s?.url).toBe("https://example.com/feed.rss");
    db.close();
  });

  test("addSchedule defaults to kind=url", () => {
    const db = makeDb();
    const id = addSchedule(db, "https://example.com", "0 * * * *");
    const schedules = listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s?.kind).toBe("url");
    db.close();
  });

  test("can mix url and rss_feed schedules in same table", () => {
    const db = makeDb();
    addSchedule(db, "https://example.com", "0 * * * *");
    addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = listSchedules(db);
    expect(schedules.some((s) => s.kind === "url")).toBe(true);
    expect(schedules.some((s) => s.kind === "rss_feed")).toBe(true);
    db.close();
  });
});
