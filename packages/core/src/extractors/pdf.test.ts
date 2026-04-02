import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
import { pdfExtractor } from "./pdf";

/** Minimal Page stub whose pdf() always throws (simulates Playwright unavailable). */
function makeFailingPage(): Page {
  return {
    pdf: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `pdf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("pdfExtractor", () => {
  test("does not throw when page.pdf() fails (graceful degradation)", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await expect(pdfExtractor(db, 1, snapshotDir, page)).resolves.toBeUndefined();
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await pdfExtractor(db, 1, snapshotDir, page);

    const rows = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
      )
      .all();

    // No row should exist since extraction failed (no PDF written)
    const pdfRow = rows.find((r) => r.extractor === "pdf");
    expect(pdfRow).toBeUndefined();
  });
});
