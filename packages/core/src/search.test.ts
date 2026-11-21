import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import {
  indexSnapshot,
  rebuildIndex,
  removeFromIndex,
  renderSnippet,
  searchSnapshots,
} from "./search";
import { addTagToSnapshot, createTag, deleteTag, removeTagFromSnapshot } from "./tags";

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
  test("returns empty result when index is empty", () => {
    const result = searchSnapshots(db, "anything");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("returns empty result for blank query", () => {
    indexSnapshot(db, 1, "https://example.com", "Example Title", "some text", "");
    const result = searchSnapshots(db, "   ");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
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

    const result = searchSnapshots(db, "SQLite");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
    expect(result.items[0]?.url).toBe("https://example.com");
    expect(result.total).toBeGreaterThan(0);
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

    const result = searchSnapshots(db, "archiving tool");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(2);
  });

  test("finds snapshot by tag", () => {
    indexSnapshot(db, 1, "https://example.com", "Some Page", "", "technology opensource");

    const result = searchSnapshots(db, "opensource");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
  });

  test("returns no results for unindexed term", () => {
    indexSnapshot(db, 1, "https://example.com", "Hello World", "some text here", "");
    const result = searchSnapshots(db, "xyzzy_not_in_index");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("returns empty result for invalid FTS query (no throw)", () => {
    indexSnapshot(db, 1, "https://example.com", "Test", "test content", "");
    // Unmatched quote is an invalid FTS5 expression
    const result = searchSnapshots(db, '"unclosed');
    expect(result.items).toHaveLength(0);
  });

  test("paginates search results", () => {
    indexSnapshot(db, 1, "https://example.com", "Page One", "archiving content page", "");
    indexSnapshot(db, 2, "https://test.org/article", "Page Two", "archiving content page", "");

    const page1 = searchSnapshots(db, "archiving", 1, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(1);

    const page2 = searchSnapshots(db, "archiving", 1, 2);
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(2);
    expect(page2.page).toBe(2);
  });
});

describe("removeFromIndex", () => {
  test("removes snapshot from search results", () => {
    indexSnapshot(db, 1, "https://example.com", "Unique Title XYZ", "unique content", "");
    expect(searchSnapshots(db, "XYZ").items).toHaveLength(1);

    removeFromIndex(db, 1);
    expect(searchSnapshots(db, "XYZ").items).toHaveLength(0);
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

    const result = searchSnapshots(db, "archiving");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
  });
});

describe("snippet escaping", () => {
  test("archived markup is escaped; only the highlight is real HTML", () => {
    indexSnapshot(
      db,
      1,
      "https://example.com",
      "XSS write-up",
      'payload <img src=x onerror=alert(1)> & "quotes" near the keyword frostbite',
      "",
    );

    const [hit] = searchSnapshots(db, "frostbite").items;

    expect(hit?.snippet).toContain("<mark>frostbite</mark>");
    expect(hit?.snippet).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(hit?.snippet).toContain("&amp;");
    expect(hit?.snippet).toContain("&quot;quotes&quot;");
    // No tag other than <mark> survives.
    expect(hit?.snippet.replace(/<\/?mark>/g, "")).not.toMatch(/[<>]/);
  });

  test("a literal <mark> in the page text is escaped, not treated as a highlight", () => {
    expect(renderSnippet("before <mark>fake</mark> after")).toBe(
      "before &lt;mark&gt;fake&lt;/mark&gt; after",
    );
  });
});

describe("tags in the search index", () => {
  beforeEach(() => {
    indexSnapshot(db, 1, "https://example.com", "Example", "plain body text", "");
  });

  test("a tag added after archiving becomes searchable", () => {
    const tag = createTag(db, "glaciology");
    expect(searchSnapshots(db, "glaciology").total).toBe(0);

    addTagToSnapshot(db, 1, tag.id);

    expect(searchSnapshots(db, "glaciology").items.map((r) => r.id)).toEqual([1]);
  });

  test("removing the tag from the snapshot removes it from search", () => {
    const tag = createTag(db, "glaciology");
    addTagToSnapshot(db, 1, tag.id);

    removeTagFromSnapshot(db, 1, tag.id);

    expect(searchSnapshots(db, "glaciology").total).toBe(0);
    expect(searchSnapshots(db, "plain").total).toBe(1);
  });

  test("deleting the tag removes it from every indexed snapshot", () => {
    const tag = createTag(db, "glaciology");
    addTagToSnapshot(db, 1, tag.id);

    deleteTag(db, tag.id);

    expect(searchSnapshots(db, "glaciology").total).toBe(0);
  });

  test("tagging a snapshot that is not indexed yet is harmless", () => {
    const tag = createTag(db, "pending-tag");
    expect(() => addTagToSnapshot(db, 2, tag.id)).not.toThrow();
    expect(searchSnapshots(db, "pending").total).toBe(0);
  });
});

describe("search options", () => {
  beforeEach(() => {
    db.query("UPDATE snapshots SET status = 'failed' WHERE id = 2").run();
    indexSnapshot(db, 1, "https://example.com", "One", "shared keyword alpha", "");
    indexSnapshot(db, 2, "https://test.org/article", "Two", "shared keyword beta", "");
  });

  test("filters hits by snapshot status, including the total", () => {
    expect(searchSnapshots(db, "shared").total).toBe(2);

    const failed = searchSnapshots(db, "shared", 20, 1, "failed");
    expect(failed.items.map((r) => r.id)).toEqual([2]);
    expect(failed.total).toBe(1);

    expect(searchSnapshots(db, "shared", 20, 1, "pending").total).toBe(0);
  });

  test("fractional or nonsensical paging values are normalised instead of failing", () => {
    const result = searchSnapshots(db, "shared", 1.9, 1.5);
    expect(result.limit).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);

    expect(searchSnapshots(db, "shared", Number.NaN, -3).items).toHaveLength(2);
  });
});
