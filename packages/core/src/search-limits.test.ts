import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { listSnapshotsWithExtractorsPaginated, pageWindow } from "./list";
import { indexSnapshot, searchSnapshots } from "./search";
import {
  MARK_CLOSE,
  MARK_OPEN,
  buildSnippet,
  parseSearchQuery,
  toMysqlBoolean,
  tokenize,
} from "./search-text";
import { getStats } from "./stats";
import type { StorageBackend } from "./storage";

const mark = (raw: string) => raw.replaceAll(MARK_OPEN, "[").replaceAll(MARK_CLOSE, "]");

describe("tokenize: normalisation before splitting", () => {
  test("characters that decompose into punctuation or spaces become separators", () => {
    for (const w of tokenize("⑴ ½ ⒈ ͺ ﷺ café")) expect(w).toMatch(/^[\p{L}\p{N}]+$/u);
    expect(toMysqlBoolean(parseSearchQuery("⑴*"))).toBe("+1*");
    expect(parseSearchQuery("ͺ")).toEqual([]);
  });
});

describe("query and snippet cost bounds", () => {
  test("a query keeps at most 32 terms and reads at most 512 characters", () => {
    const clauses = parseSearchQuery(Array.from({ length: 100 }, (_, i) => `w${i}`).join(" "));
    expect(clauses).toHaveLength(32);
    expect(parseSearchQuery(`${"a".repeat(600)} tail`)[0]?.alternatives[0]?.words[0]).toHaveLength(
      512,
    );
  });

  test("a huge query of one repeated word still builds a snippet quickly", () => {
    const text = Array.from({ length: 90_000 }, () => "https").join(" ");
    const clauses = parseSearchQuery(Array.from({ length: 2700 }, () => "https").join(" "));
    const started = performance.now();
    buildSnippet(text, clauses);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a snippet is built from the first 100,000 characters only", () => {
    const text = `${"filler ".repeat(20_000)}needle`;
    expect(mark(buildSnippet(text, parseSearchQuery("needle")))).not.toContain("[needle]");
    expect(mark(buildSnippet(`needle ${text}`, parseSearchQuery("needle")))).toContain("[needle]");
  });
});

describe("pageWindow", () => {
  test("only whole numbers a database can hold get through", () => {
    expect(pageWindow(3, 10)).toEqual({ page: 3, limit: 10, offset: 20 });
    expect(pageWindow(Number.POSITIVE_INFINITY, 20).page).toBe(1);
    expect(pageWindow(Number.NaN, Number.NaN)).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(pageWindow(1.9, 2.9)).toEqual({ page: 1, limit: 2, offset: 0 });
    const huge = pageWindow(2e15, 200);
    expect(Number.isSafeInteger(huge.offset)).toBe(true);
  });
});

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `search-limits-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("page and limit that are not whole numbers", () => {
  test("search and list fall back instead of failing", async () => {
    await indexSnapshot(db, 1, "https://example.com", "Test", "test content", "");
    for (const [page, limit] of [
      [Number.POSITIVE_INFINITY, 20],
      [Number.NaN, Number.NaN],
      [1e300, 20],
      [2e301, 200],
      [1, Number.POSITIVE_INFINITY],
      [1.7, 2.9],
    ] as const) {
      const found = await searchSnapshots(db, "test", limit, page);
      expect(Number.isSafeInteger(found.page)).toBe(true);
      expect(Number.isSafeInteger(found.limit)).toBe(true);
      const listed = await listSnapshotsWithExtractorsPaginated(db, page, limit);
      expect(Number.isSafeInteger(listed.page)).toBe(true);
      expect(listed.total).toBe(1);
    }
    expect((await searchSnapshots(db, "test", 5, Number.POSITIVE_INFINITY)).total).toBe(1);
  });
});

describe("a database error is not an empty search (SQLite)", () => {
  test("a missing FTS table throws; a malformed query is still empty", async () => {
    if (db.dialect !== "sqlite") return;
    expect((await searchSnapshots(db, '"unclosed')).items).toEqual([]);
    await db.run(sql`DROP TABLE snapshots_fts`);
    await expect(searchSnapshots(db, "test")).rejects.toThrow();
  });
});

describe("size backfill", () => {
  async function legacyRows(count: number) {
    for (let i = 0; i < count; i++) {
      await db.run(
        sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (1, 'screenshot', ${`ref-${i}`})`,
      );
    }
  }
  const storageWith = (fileSize: (ref: string) => Promise<number>) =>
    ({ fileSize }) as unknown as StorageBackend;

  test("a failing lookup leaves the size unset so a later call retries", async () => {
    await legacyRows(3);
    let failing = true;
    const storage = storageWith(async (ref) => {
      if (failing && ref === "ref-1") throw new Error("503 SlowDown");
      return 10;
    });
    await getStats(db, storage);
    const rows = () =>
      db.all<{ content: string; size_bytes: number | null }>(
        sql`SELECT content, size_bytes FROM archive_results ORDER BY id`,
      );
    expect((await rows()).map((r) => r.size_bytes)).toEqual([10, null, 10]);
    failing = false;
    await getStats(db, storage);
    expect((await rows()).map((r) => r.size_bytes)).toEqual([10, 10, 10]);
  });

  test("storage is asked about at most 16 files at a time", async () => {
    await legacyRows(60);
    let inFlight = 0;
    let peak = 0;
    const storage = storageWith(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return 1;
    });
    const stats = await getStats(db, storage);
    expect(peak).toBeLessThanOrEqual(16);
    expect(stats.storageByExtractor.screenshot).toBe(60);
  });
});
