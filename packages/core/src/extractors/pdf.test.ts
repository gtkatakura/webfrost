import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { pdfExtractor } from "./pdf";

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
  test("does not throw when Playwright is unavailable (graceful degradation)", async () => {
    // We can't mock the import, but we can at least verify pdfExtractor doesn't crash the pipeline
    // when invoked against an unreachable URL (Playwright would fail to load the page)
    const snapshotDir = join(testDir, "snapshots", "1");

    // Expect no throw even if Playwright isn't installed / page fails to load
    await expect(
      pdfExtractor(db, 1, "http://localhost:19998/unreachable", snapshotDir),
    ).resolves.toBeUndefined();
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");

    await pdfExtractor(db, 1, "http://localhost:19998/unreachable", snapshotDir);

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
