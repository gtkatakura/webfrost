import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, sql } from "@webfrost/core";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(async () => {
  // Each test archive is its own database; release the pools so a server-backed run does not pile up connections.
  const { closeDatabases } = await import("@webfrost/core");
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function getApp() {
  const { statsRouter } = await import("./stats");
  const { Elysia } = await import("elysia");
  return new Elysia().use(statsRouter);
}

interface StatsBody {
  snapshotCount: number;
  storageBytes: number;
  storageByExtractor: Record<string, number>;
  successRate: number;
  activeScheduleCount: number;
  failedToday: number;
}

// ---------------------------------------------------------------------------
// GET /stats — empty database
// ---------------------------------------------------------------------------

describe("GET /stats — empty database", () => {
  test("returns zero values for all fields", async () => {
    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsBody;
    expect(body.snapshotCount).toBe(0);
    expect(body.storageBytes).toBe(0);
    expect(body.storageByExtractor).toEqual({});
    expect(body.successRate).toBe(0);
    expect(body.activeScheduleCount).toBe(0);
    expect(body.failedToday).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /stats — happy path
// ---------------------------------------------------------------------------

describe("GET /stats — happy path", () => {
  test("returns correct aggregated stats", async () => {
    const db = await openDb(testDir);
    try {
      // Two done snapshots + one failed today
      await db.run(sql`INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://example.com', 'done', ${db.ago(86400)}),
          ('https://example.org', 'done', ${db.ago(2 * 86400)}),
          ('https://fail.com', 'failed', ${db.now()})`);
      await db.run(sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES
          (1, 'html', '<html>hello world</html>'),
          (1, 'readability', 'hello world'),
          (2, 'html', '<html>other page</html>')`);
      await db.run(sql`INSERT INTO schedules (url, cron, next_run_at, kind) VALUES
          ('https://example.com', '0 * * * *', ${db.ago(-3600)}, 'url'),
          ('https://example.org', '0 * * * *', ${db.ago(-3600)}, 'url')`);
    } finally {
      await db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsBody;

    expect(body.snapshotCount).toBe(3);
    expect(body.storageBytes).toBeGreaterThan(0);
    expect(body.storageByExtractor.html).toBeGreaterThan(0);
    expect(body.storageByExtractor.readability).toBeGreaterThan(0);
    // 2 done out of 3 non-pending = 66.67%
    expect(body.successRate).toBeCloseTo(66.67, 0);
    expect(body.activeScheduleCount).toBe(2);
    expect(body.failedToday).toBe(1);
  });

  test("successRate is 100 when all recent snapshots succeeded", async () => {
    const db = await openDb(testDir);
    try {
      await db.run(sql`INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://a.com', 'done', ${db.now()}),
          ('https://b.com', 'done', ${db.now()})`);
    } finally {
      await db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    const body = (await res.json()) as StatsBody;
    expect(body.successRate).toBe(100);
  });

  test("activeScheduleCount excludes paused schedules", async () => {
    const db = await openDb(testDir);
    try {
      await db.run(sql`INSERT INTO schedules (url, cron, next_run_at, kind) VALUES
          ('https://active.com', '0 * * * *', ${db.ago(-3600)}, 'url'),
          ('https://paused.com', '0 * * * *', ${db.ago(-3600)}, 'url')`);
      await db.run(sql`UPDATE schedules SET paused = 1 WHERE url = 'https://paused.com'`);
    } finally {
      await db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    const body = (await res.json()) as StatsBody;
    expect(body.activeScheduleCount).toBe(1);
  });

  test("excludes snapshots older than 30 days from successRate", async () => {
    const db = await openDb(testDir);
    try {
      await db.run(sql`INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://old-fail.com', 'failed', ${db.ago(31 * 86400)}),
          ('https://recent.com', 'done', ${db.now()})`);
    } finally {
      await db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    const body = (await res.json()) as StatsBody;
    // Only the recent done snapshot counts → 100%
    expect(body.successRate).toBe(100);
  });
});
