import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { isUrlArchived } from "./rss";
import { addRssFeedSchedule, addSchedule, listSchedules } from "./schedules";

let testDir: string;

afterEach(() => {
  if (testDir) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function makeDb() {
  testDir = mkdtempSync(join(tmpdir(), "rss-test-"));
  return openDb(testDir);
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
