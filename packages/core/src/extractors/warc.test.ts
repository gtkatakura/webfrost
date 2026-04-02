import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { warcExtractor } from "./warc";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `warc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  // Insert a snapshot row to satisfy FK constraint
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

describe("warcExtractor", () => {
  test("writes a valid WARC/1.1 file to snapshotDir", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const mockHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
    const html = "<html><body>Hello WARC</body></html>";

    await warcExtractor(db, 1, "https://example.com", mockHeaders, 200, "OK", html, snapshotDir);

    const warcPath = join(snapshotDir, "archive.warc");
    expect(existsSync(warcPath)).toBe(true);

    const content = readFileSync(warcPath, "utf8");
    expect(content).toContain("WARC/1.1");
    expect(content).toContain("WARC-Type: warcinfo");
    expect(content).toContain("WARC-Type: response");
    expect(content).toContain("https://example.com");
    expect(content).toContain("Hello WARC");
  });

  test("stores WARC file path in archive_results with extractor=warc", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const mockHeaders = new Headers({ "content-type": "text/html" });

    await warcExtractor(
      db,
      1,
      "https://example.com",
      mockHeaders,
      200,
      "OK",
      "<html/>",
      snapshotDir,
    );

    const row = db
      .query<{ extractor: string; content: string }, []>(
        "SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 LIMIT 1",
      )
      .get();

    expect(row).not.toBeNull();
    expect(row?.extractor).toBe("warc");
    expect(row?.content).toContain("archive.warc");
  });

  test("creates snapshotDir if it does not exist", async () => {
    const snapshotDir = join(testDir, "snapshots", "99");
    const mockHeaders = new Headers({});

    await warcExtractor(
      db,
      1,
      "https://example.com",
      mockHeaders,
      200,
      "OK",
      "<html/>",
      snapshotDir,
    );

    expect(existsSync(snapshotDir)).toBe(true);
  });
});
