import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@webfrost/core";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(() => {
  process.env.WEBFROST_DIR = undefined;
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
    const db = openDb(testDir);
    try {
      // Two done snapshots + one failed today
      db.exec(`
        INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://example.com', 'done', datetime('now', '-1 day')),
          ('https://example.org', 'done', datetime('now', '-2 days')),
          ('https://fail.com', 'failed', datetime('now'));
        INSERT INTO archive_results (snapshot_id, extractor, content) VALUES
          (1, 'html', '<html>hello world</html>'),
          (1, 'readability', 'hello world'),
          (2, 'html', '<html>other page</html>');
        INSERT INTO schedules (url, cron, next_run_at, kind) VALUES
          ('https://example.com', '0 * * * *', datetime('now', '+1 hour'), 'url'),
          ('https://example.org', '0 * * * *', datetime('now', '+1 hour'), 'url');
      `);
    } finally {
      db.close();
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
    const db = openDb(testDir);
    try {
      db.exec(`
        INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://a.com', 'done', datetime('now')),
          ('https://b.com', 'done', datetime('now'));
      `);
    } finally {
      db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    const body = (await res.json()) as StatsBody;
    expect(body.successRate).toBe(100);
  });

  test("excludes snapshots older than 30 days from successRate", async () => {
    const db = openDb(testDir);
    try {
      db.exec(`
        INSERT INTO snapshots (url, status, created_at) VALUES
          ('https://old-fail.com', 'failed', datetime('now', '-31 days')),
          ('https://recent.com', 'done', datetime('now'));
      `);
    } finally {
      db.close();
    }

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/stats"));
    const body = (await res.json()) as StatsBody;
    // Only the recent done snapshot counts → 100%
    expect(body.successRate).toBe(100);
  });
});
