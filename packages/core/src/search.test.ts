import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { indexSnapshot, rebuildIndex, removeFromIndex, searchSnapshots } from "./search";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')").run();
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://test.org/article', 'done')").run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("indexSnapshot / searchSnapshots", () => {
  test("returns empty array when index is empty", () => {
    const results = searchSnapshots(db, "anything");
    expect(results).toHaveLength(0);
  });

  test("returns empty array for blank query", () => {
    indexSnapshot(db, 1, "https://example.com", "Example Title", "some text", "");
    const results = searchSnapshots(db, "   ");
    expect(results).toHaveLength(0);
  });

  test("finds indexed snapshot by title", () => {
    indexSnapshot(
      db,
      1,
      "https://example.com",
      "SQLite Performance Guide",
      "SQLite is fast and reliable",
      "",
    );

    const results = searchSnapshots(db, "SQLite");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(1);
    expect(results[0]?.url).toBe("https://example.com");
  });

  test("finds snapshot by text content", () => {
    indexSnapshot(
      db,
      2,
      "https://test.org/article",
      "My Article",
      "WebFrost is an excellent archiving tool for preserving web pages",
      "",
    );

    const results = searchSnapshots(db, "archiving tool");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(2);
  });

  test("finds snapshot by tag", () => {
    indexSnapshot(db, 1, "https://example.com", "Some Page", "", "technology opensource");

    const results = searchSnapshots(db, "opensource");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(1);
  });

  test("returns no results for unindexed term", () => {
    indexSnapshot(db, 1, "https://example.com", "Hello World", "some text here", "");
    const results = searchSnapshots(db, "xyzzy_not_in_index");
    expect(results).toHaveLength(0);
  });

  test("returns empty array for invalid FTS query (no throw)", () => {
    indexSnapshot(db, 1, "https://example.com", "Test", "test content", "");
    // Unmatched quote is an invalid FTS5 expression
    const results = searchSnapshots(db, '"unclosed');
    expect(results).toHaveLength(0);
  });
});

describe("removeFromIndex", () => {
  test("removes snapshot from search results", () => {
    indexSnapshot(db, 1, "https://example.com", "Unique Title XYZ", "unique content", "");
    expect(searchSnapshots(db, "XYZ")).toHaveLength(1);

    removeFromIndex(db, 1);
    expect(searchSnapshots(db, "XYZ")).toHaveLength(0);
  });
});

describe("rebuildIndex", () => {
  test("indexes done snapshots with readability content", () => {
    const readabilityContent = JSON.stringify({
      title: "Rebuild Test Article",
      textContent: "Interesting content about archiving",
    });
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (1, 'readability', ?)",
    ).run(readabilityContent);

    rebuildIndex(db);

    const results = searchSnapshots(db, "archiving");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe(1);
  });
});
