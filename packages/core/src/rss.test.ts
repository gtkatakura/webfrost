import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
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

async function makeDb() {
  testDir = mkdtempSync(join(tmpdir(), "rss-test-"));
  return openDb(testDir);
}

describe("isUrlArchived", () => {
  test("returns false when no snapshots exist", async () => {
    const db = await makeDb();
    expect(await isUrlArchived(db, "https://example.com")).toBe(false);
    await db.close();
  });

  test("returns true when the exact URL is archived", async () => {
    const db = await makeDb();
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
    expect(await isUrlArchived(db, "https://example.com")).toBe(true);
    await db.close();
  });

  test("returns false for a different URL", async () => {
    const db = await makeDb();
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
    expect(await isUrlArchived(db, "https://other.com")).toBe(false);
    await db.close();
  });
});

describe("addRssFeedSchedule", () => {
  test("creates a schedule with kind=rss_feed", async () => {
    const db = await makeDb();
    const id = await addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = await listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s).toBeDefined();
    expect(s?.kind).toBe("rss_feed");
    expect(s?.url).toBe("https://example.com/feed.rss");
    await db.close();
  });

  test("addSchedule defaults to kind=url", async () => {
    const db = await makeDb();
    const id = await addSchedule(db, "https://example.com", "0 * * * *");
    const schedules = await listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s?.kind).toBe("url");
    await db.close();
  });

  test("can mix url and rss_feed schedules in same table", async () => {
    const db = await makeDb();
    await addSchedule(db, "https://example.com", "0 * * * *");
    await addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = await listSchedules(db);
    expect(schedules.some((s) => s.kind === "url")).toBe(true);
    expect(schedules.some((s) => s.kind === "rss_feed")).toBe(true);
    await db.close();
  });
});
