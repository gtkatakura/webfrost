import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
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
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `screenshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
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

describe("screenshotExtractor", () => {
  test("does not throw when page.screenshot() fails (graceful degradation)", async () => {
    const page = makeFailingPage();

    await expect(screenshotExtractor(db, 1, makeStorage(), page)).resolves.toBeUndefined();
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await screenshotExtractor(db, 1, makeStorage(), page);

    const rows = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
      )
      .all();

    const screenshotRow = rows.find((r) => r.extractor === "screenshot");
    expect(screenshotRow).toBeUndefined();
  });
});
