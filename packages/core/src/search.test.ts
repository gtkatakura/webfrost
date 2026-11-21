import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import {
  indexSnapshot,
  rebuildIndex,
  removeFromIndex,
  renderSnippet,
  searchSnapshots,
} from "./search";
import { addTagToSnapshot, createTag, deleteTag, removeTagFromSnapshot } from "./tags";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
  await db.run(
    sql`INSERT INTO snapshots (url, status) VALUES ('https://test.org/article', 'done')`,
  );
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("indexSnapshot / searchSnapshots", () => {
  test("returns empty result when index is empty", async () => {
    const result = await searchSnapshots(db, "anything");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("returns empty result for blank query", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Example Title", "some text", "");
    const result = await searchSnapshots(db, "   ");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("finds indexed snapshot by title", async () => {
    await indexSnapshot(
      db,
      1,
      "https://example.com",
      "SQLite Performance Guide",
      "SQLite is fast and reliable",
      "",
    );

    const result = await searchSnapshots(db, "SQLite");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
    expect(result.items[0]?.url).toBe("https://example.com");
    expect(result.total).toBeGreaterThan(0);
  });

  test("finds snapshot by text content", async () => {
    await indexSnapshot(
      db,
      2,
      "https://test.org/article",
      "My Article",
      "WebFrost is an excellent archiving tool for preserving web pages",
      "",
    );

    const result = await searchSnapshots(db, "archiving tool");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(2);
  });

  test("finds snapshot by tag", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Some Page", "", "technology opensource");

    const result = await searchSnapshots(db, "opensource");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
  });

  test("returns no results for unindexed term", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Hello World", "some text here", "");
    const result = await searchSnapshots(db, "xyzzy_not_in_index");
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("returns empty result for invalid FTS query (no throw)", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Test", "test content", "");
    // Unmatched quote is an invalid FTS5 expression
    const result = await searchSnapshots(db, '"unclosed');
    expect(result.items).toHaveLength(0);
  });

  test("paginates search results", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Page One", "archiving content page", "");
    await indexSnapshot(
      db,
      2,
      "https://test.org/article",
      "Page Two",
      "archiving content page",
      "",
    );

    const page1 = await searchSnapshots(db, "archiving", 1, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(1);

    const page2 = await searchSnapshots(db, "archiving", 1, 2);
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(2);
    expect(page2.page).toBe(2);
  });
});

describe("removeFromIndex", () => {
  test("removes snapshot from search results", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Unique Title XYZ", "unique content", "");
    expect((await searchSnapshots(db, "XYZ")).items).toHaveLength(1);

    await removeFromIndex(db, 1);
    expect((await searchSnapshots(db, "XYZ")).items).toHaveLength(0);
  });
});

describe("rebuildIndex", () => {
  test("indexes done snapshots with readability content", async () => {
    const readabilityContent = JSON.stringify({
      title: "Rebuild Test Article",
      textContent: "Interesting content about archiving",
    });
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (1, 'readability', ${readabilityContent})`,
    );

    await rebuildIndex(db);

    const result = await searchSnapshots(db, "archiving");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe(1);
  });
});

describe("snippet escaping", () => {
  test("archived markup is escaped; only the highlight is real HTML", async () => {
    await indexSnapshot(
      db,
      1,
      "https://example.com",
      "XSS write-up",
      'payload <img src=x onerror=alert(1)> & "quotes" near the keyword frostbite',
      "",
    );

    const [hit] = (await searchSnapshots(db, "frostbite")).items;

    expect(hit?.snippet).toContain("<mark>frostbite</mark>");
    expect(hit?.snippet).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(hit?.snippet).toContain("&amp;");
    expect(hit?.snippet).toContain("&quot;quotes&quot;");
    // No tag other than <mark> survives.
    expect(hit?.snippet.replace(/<\/?mark>/g, "")).not.toMatch(/[<>]/);
  });

  test("a literal <mark> in the page text is escaped, not treated as a highlight", async () => {
    expect(renderSnippet("before <mark>fake</mark> after")).toBe(
      "before &lt;mark&gt;fake&lt;/mark&gt; after",
    );
  });
});

describe("tags in the search index", () => {
  beforeEach(async () => {
    await indexSnapshot(db, 1, "https://example.com", "Example", "plain body text", "");
  });

  test("a tag added after archiving becomes searchable", async () => {
    const tag = await createTag(db, "glaciology");
    expect((await searchSnapshots(db, "glaciology")).total).toBe(0);

    await addTagToSnapshot(db, 1, tag.id);

    expect((await searchSnapshots(db, "glaciology")).items.map((r) => r.id)).toEqual([1]);
  });

  test("removing the tag from the snapshot removes it from search", async () => {
    const tag = await createTag(db, "glaciology");
    await addTagToSnapshot(db, 1, tag.id);

    await removeTagFromSnapshot(db, 1, tag.id);

    expect((await searchSnapshots(db, "glaciology")).total).toBe(0);
    expect((await searchSnapshots(db, "plain")).total).toBe(1);
  });

  test("deleting the tag removes it from every indexed snapshot", async () => {
    const tag = await createTag(db, "glaciology");
    await addTagToSnapshot(db, 1, tag.id);

    await deleteTag(db, tag.id);

    expect((await searchSnapshots(db, "glaciology")).total).toBe(0);
  });

  test("tagging a snapshot that is not indexed yet is harmless", async () => {
    const tag = await createTag(db, "pending-tag");
    await expect(addTagToSnapshot(db, 2, tag.id)).resolves.toBeUndefined();
    expect((await searchSnapshots(db, "pending")).total).toBe(0);
  });
});

describe("search options", () => {
  beforeEach(async () => {
    await db.run(sql`UPDATE snapshots SET status = 'failed' WHERE id = 2`);
    await indexSnapshot(db, 1, "https://example.com", "One", "shared keyword alpha", "");
    await indexSnapshot(db, 2, "https://test.org/article", "Two", "shared keyword beta", "");
  });

  test("filters hits by snapshot status, including the total", async () => {
    expect((await searchSnapshots(db, "shared")).total).toBe(2);

    const failed = await searchSnapshots(db, "shared", 20, 1, "failed");
    expect(failed.items.map((r) => r.id)).toEqual([2]);
    expect(failed.total).toBe(1);

    expect((await searchSnapshots(db, "shared", 20, 1, "pending")).total).toBe(0);
  });

  test("fractional or nonsensical paging values are normalised instead of failing", async () => {
    const result = await searchSnapshots(db, "shared", 1.9, 1.5);
    expect(result.limit).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);

    expect((await searchSnapshots(db, "shared", Number.NaN, -3)).items).toHaveLength(2);
  });
});
