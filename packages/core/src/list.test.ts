import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { type SnapshotFilter, listSnapshotsWithExtractorsPaginated } from "./list";
import { indexSnapshot, searchSnapshots } from "./search";
import { addTagToSnapshot, createTag } from "./tags";

let testDir: string;
let db: Db;
let newsTag: number;
let readLaterTag: number;

/**
 * Five snapshots, one per row; only what a filter can tell apart differs between them.
 *
 *   1 done    2026-01-10  docs.example.com/guide      "Glacier Field Guide"   html pdf      news
 *   2 done    2026-02-10  blog.example.org/ice        "Notes on SEA ICE"      html          news, read later
 *   3 failed  2026-03-10  gone.example.net/glacier    (no title)
 *   4 pending 2026-04-10  example.com/100%_done       (no title)
 *   5 done    2026-05-10  shop.example.com/boots      "Winter boots"          html pdf(failed)
 */
beforeEach(async () => {
  testDir = join(tmpdir(), `list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);

  const snapshots: Array<[string, string, string]> = [
    ["https://docs.example.com/guide", "done", "2026-01-10 12:00:00"],
    ["https://blog.example.org/ice", "done", "2026-02-10 12:00:00"],
    ["https://gone.example.net/glacier", "failed", "2026-03-10 12:00:00"],
    ["https://example.com/100%_done", "pending", "2026-04-10 12:00:00"],
    ["https://shop.example.com/boots", "done", "2026-05-10 12:00:00"],
  ];
  for (const [url, status, createdAt] of snapshots) {
    await db.run(
      sql`INSERT INTO snapshots (url, status, created_at) VALUES (${url}, ${status}, ${createdAt})`,
    );
  }

  const results: Array<[number, string, string | null]> = [
    [1, "html", null],
    [1, "pdf", null],
    [2, "html", null],
    [5, "html", null],
    [5, "pdf", "browser crashed"],
  ];
  for (const [snapshotId, extractor, error] of results) {
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content, error)
          VALUES (${snapshotId}, ${extractor}, ${error === null ? "content" : null}, ${error})`,
    );
  }

  await indexSnapshot(db, 1, "https://docs.example.com/guide", "Glacier Field Guide", "ice", "");
  await indexSnapshot(db, 2, "https://blog.example.org/ice", "Notes on SEA ICE", "ice", "");
  await indexSnapshot(db, 5, "https://shop.example.com/boots", "Winter boots", "ice", "");

  newsTag = (await createTag(db, "news")).id;
  readLaterTag = (await createTag(db, "read later")).id;
  await addTagToSnapshot(db, 1, newsTag);
  await addTagToSnapshot(db, 2, newsTag);
  await addTagToSnapshot(db, 2, readLaterTag);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

/** Ids the list keeps, newest first, and the total it reports. */
async function listed(filter?: SnapshotFilter | string): Promise<number[]> {
  const result = await listSnapshotsWithExtractorsPaginated(db, 1, 20, filter);
  expect(result.total).toBe(result.items.length);
  return result.items.map((s) => Number(s.id));
}

describe("listSnapshotsWithExtractorsPaginated filters", () => {
  test("no filter keeps every snapshot", async () => {
    expect(await listed()).toEqual([5, 4, 3, 2, 1]);
    expect(await listed({})).toEqual([5, 4, 3, 2, 1]);
  });

  test("a status alone, as a string or in a filter", async () => {
    expect(await listed("failed")).toEqual([3]);
    expect(await listed({ statuses: ["failed"] })).toEqual([3]);
  });

  test("several statuses keep a snapshot in any of them", async () => {
    expect(await listed({ statuses: ["failed", "pending"] })).toEqual([4, 3]);
  });

  test("since is inclusive and before is exclusive", async () => {
    expect(await listed({ since: "2026-03-10 12:00:00" })).toEqual([5, 4, 3]);
    expect(await listed({ before: "2026-03-10 12:00:00" })).toEqual([2, 1]);
    expect(await listed({ since: "2026-02-01 00:00:00", before: "2026-04-01 00:00:00" })).toEqual([
      3, 2,
    ]);
  });

  test("an extractor counts only where it produced output", async () => {
    expect(await listed({ extractors: ["html"] })).toEqual([5, 2, 1]);
    // Snapshot 5 has a pdf row, but it is an error.
    expect(await listed({ extractors: ["pdf"] })).toEqual([1]);
    expect(await listed({ extractors: ["html", "pdf"] })).toEqual([1]);
    expect(await listed({ extractors: ["warc"] })).toEqual([]);
  });

  test("several tags keep a snapshot that carries all of them", async () => {
    expect(await listed({ tagIds: [newsTag] })).toEqual([2, 1]);
    expect(await listed({ tagIds: [newsTag, readLaterTag] })).toEqual([2]);
  });

  test("contains matches the URL of any snapshot, indexed or not", async () => {
    // Snapshot 3 failed: it has no title and is not in the search index.
    expect(await listed({ contains: "gone.example" })).toEqual([3]);
    expect(await listed({ contains: "EXAMPLE.ORG" })).toEqual([2]);
  });

  test("contains matches the title, in the middle of a word and whatever the case", async () => {
    // "lacier" is in the title of 1 and in the URL of 3.
    expect(await listed({ contains: "lacier" })).toEqual([3, 1]);
    expect(await listed({ contains: "sea ice" })).toEqual([2]);
    expect(await listed({ contains: "nothing like it" })).toEqual([]);
  });

  test("contains takes % and _ literally", async () => {
    expect(await listed({ contains: "100%_d" })).toEqual([4]);
    expect(await listed({ contains: "%" })).toEqual([4]);
    expect(await listed({ contains: "_" })).toEqual([4]);
    // As a wildcard this would match "guide" and "glacier".
    expect(await listed({ contains: "g_i" })).toEqual([]);
  });

  test("a blank contains keeps everything", async () => {
    expect(await listed({ contains: "   " })).toEqual([5, 4, 3, 2, 1]);
  });

  test("filters combine, and the total and the pages follow the filtered list", async () => {
    expect(await listed({ statuses: ["done"], contains: "example.com" })).toEqual([5, 1]);

    const first = await listSnapshotsWithExtractorsPaginated(db, 1, 2, { statuses: ["done"] });
    expect(first.items.map((s) => Number(s.id))).toEqual([5, 2]);
    expect(first.total).toBe(3);
    const second = await listSnapshotsWithExtractorsPaginated(db, 2, 2, { statuses: ["done"] });
    expect(second.items.map((s) => Number(s.id))).toEqual([1]);
    expect(second.total).toBe(3);
  });
});

describe("searchSnapshots filters", () => {
  /** Ids of the hits for "ice" (snapshots 1, 2 and 5 are indexed with it) and the total. */
  async function hits(filter?: SnapshotFilter | string): Promise<number[]> {
    const result = await searchSnapshots(db, "ice", 20, 1, filter);
    expect(result.total).toBe(result.items.length);
    return result.items.map((r) => Number(r.id)).sort((a, b) => a - b);
  }

  test("no filter keeps every hit", async () => {
    expect(await hits()).toEqual([1, 2, 5]);
  });

  test("date, extractor, tag and text narrow the hits and the total", async () => {
    expect(await hits({ since: "2026-02-01 00:00:00" })).toEqual([2, 5]);
    expect(await hits({ before: "2026-02-01 00:00:00" })).toEqual([1]);
    expect(await hits({ extractors: ["pdf"] })).toEqual([1]);
    expect(await hits({ tagIds: [newsTag, readLaterTag] })).toEqual([2]);
    expect(await hits({ contains: "boots" })).toEqual([5]);
    expect(await hits({ statuses: ["failed", "pending"] })).toEqual([]);
    expect(await hits({ statuses: ["done"], tagIds: [newsTag], extractors: ["pdf"] })).toEqual([1]);
  });
});
