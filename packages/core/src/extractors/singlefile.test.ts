import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
import { singleFileExtractor } from "./singlefile";

/** Minimal Page stub whose content() always throws. */
function makeFailingPage(): Page {
  return {
    url: () => "https://example.com",
    content: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

/** Minimal Page stub that returns fixed HTML. */
function makeSuccessPage(html: string, url = "https://example.com"): Page {
  return {
    url: () => url,
    content: async () => html,
  } as unknown as Page;
}

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `singlefile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')").run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("singleFileExtractor", () => {
  test("does not throw when page.content() fails (graceful degradation)", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await expect(singleFileExtractor(db, 1, snapshotDir, page)).resolves.toBeUndefined();
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await singleFileExtractor(db, 1, snapshotDir, page);

    const row = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeNull();
  });

  test("writes singlefile.html and inserts archive_result row on success", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const html = "<html><body><p>Hello world</p></body></html>";
    const page = makeSuccessPage(html);

    await singleFileExtractor(db, 1, snapshotDir, page);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeDefined();
    expect(row?.content).toEndWith("singlefile.html");

    expect(row?.content).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    expect(written).toContain("Hello world");
  });

  test("leaves link[rel=stylesheet] unchanged when fetch fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const html =
      '<html><head><link rel="stylesheet" href="https://nonexistent.invalid/style.css"></head><body></body></html>';
    const page = makeSuccessPage(html);

    // Should not throw even if fetch fails
    await expect(singleFileExtractor(db, 1, snapshotDir, page)).resolves.toBeUndefined();

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    // File should still be written with the original link intact
    expect(row).toBeDefined();
    expect(row?.content).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    expect(written).toContain("nonexistent.invalid");
  });
});
