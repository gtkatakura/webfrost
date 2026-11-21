import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import type { Page } from "playwright";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { screenshotExtractor } from "./screenshot";

/** Minimal Page stub whose screenshot() always throws (simulates Playwright unavailable). */
function makeFailingPage(): Page {
  return {
    screenshot: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `screenshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')`);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

describe("screenshotExtractor", () => {
  test("rejects when page.screenshot() fails so the pipeline can record the failure", async () => {
    const page = makeFailingPage();

    await expect(screenshotExtractor(db, 1, makeStorage(), page)).rejects.toThrow(
      "Playwright unavailable",
    );
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await screenshotExtractor(db, 1, makeStorage(), page).catch(() => {});

    const rows = await db.all<{ extractor: string }>(
      sql`SELECT extractor FROM archive_results WHERE snapshot_id = 1`,
    );

    const screenshotRow = rows.find((r) => r.extractor === "screenshot");
    expect(screenshotRow).toBeUndefined();
  });
});
