import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { FilesystemBackend } from "../storage";
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

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

describe("warcExtractor", () => {
  test("writes a valid WARC/1.1 file to storage", async () => {
    const storage = makeStorage();
    const mockHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
    const html = "<html><body>Hello WARC</body></html>";

    await warcExtractor(db, 1, "https://example.com", mockHeaders, 200, "OK", html, storage);

    const warcPath = join(testDir, "snapshots", "1", "archive.warc");
    expect(existsSync(warcPath)).toBe(true);

    const content = readFileSync(warcPath, "utf8");
    expect(content).toContain("WARC/1.1");
    expect(content).toContain("WARC-Type: warcinfo");
    expect(content).toContain("WARC-Type: response");
    expect(content).toContain("https://example.com");
    expect(content).toContain("Hello WARC");
  });

  test("stores WARC file ref in archive_results with extractor=warc", async () => {
    const storage = makeStorage();
    const mockHeaders = new Headers({ "content-type": "text/html" });

    await warcExtractor(db, 1, "https://example.com", mockHeaders, 200, "OK", "<html/>", storage);

    const row = db
      .query<{ extractor: string; content: string }, []>(
        "SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 LIMIT 1",
      )
      .get();

    expect(row).not.toBeNull();
    expect(row?.extractor).toBe("warc");
    expect(row?.content).toContain("archive.warc");
  });

  test("creates storage directory if it does not exist", async () => {
    const storage = makeStorage();
    const mockHeaders = new Headers({});

    await warcExtractor(db, 1, "https://example.com", mockHeaders, 200, "OK", "<html/>", storage);

    expect(existsSync(join(testDir, "snapshots", "1", "archive.warc"))).toBe(true);
  });
});
