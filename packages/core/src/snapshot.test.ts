import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { deleteSnapshot, getSnapshot } from "./snapshot";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')").run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("deleteSnapshot", () => {
  test("returns false when snapshot does not exist", async () => {
    const deleted = await deleteSnapshot(db, 9999, testDir);
    expect(deleted).toBe(false);
  });

  test("returns true and removes snapshot row", async () => {
    const deleted = await deleteSnapshot(db, 1, testDir);
    expect(deleted).toBe(true);

    const snap = getSnapshot(db, 1);
    expect(snap).toBeNull();
  });

  test("cascades to archive_results", async () => {
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (1, 'html', '<p>hi</p>')",
    ).run();

    await deleteSnapshot(db, 1, testDir);

    const rows = db
      .query<{ id: number }, []>("SELECT id FROM archive_results WHERE snapshot_id = 1")
      .all();
    expect(rows).toHaveLength(0);
  });

  test("cascades to job_queue", async () => {
    db.query("INSERT INTO job_queue (snapshot_id, status) VALUES (1, 'done')").run();

    await deleteSnapshot(db, 1, testDir);

    const rows = db
      .query<{ id: number }, []>("SELECT id FROM job_queue WHERE snapshot_id = 1")
      .all();
    expect(rows).toHaveLength(0);
  });

  test("removes snapshot artifact directory from disk", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, "screenshot.png"), "fake-png");

    await deleteSnapshot(db, 1, testDir);

    const exists = await Bun.file(join(snapshotDir, "screenshot.png")).exists();
    expect(exists).toBe(false);
  });

  test("does not throw if artifact directory is already gone", async () => {
    await expect(deleteSnapshot(db, 1, testDir)).resolves.toBe(true);
  });
});
