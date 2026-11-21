import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { deleteSnapshot, getSnapshot } from "./snapshot";
import { FilesystemBackend } from "./storage";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
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

describe("deleteSnapshot", () => {
  test("returns false when snapshot does not exist", async () => {
    const deleted = await deleteSnapshot(db, 9999, makeStorage());
    expect(deleted).toBe(false);
  });

  test("returns true and removes snapshot row", async () => {
    const deleted = await deleteSnapshot(db, 1, makeStorage());
    expect(deleted).toBe(true);

    const snap = await getSnapshot(db, 1);
    expect(snap).toBeNull();
  });

  test("cascades to archive_results", async () => {
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (1, 'html', '<p>hi</p>')`,
    );

    await deleteSnapshot(db, 1, makeStorage());

    const rows = await db.all<{ id: number }>(
      sql`SELECT id FROM archive_results WHERE snapshot_id = 1`,
    );
    expect(rows).toHaveLength(0);
  });

  test("cascades to job_queue", async () => {
    await db.run(sql`INSERT INTO job_queue (snapshot_id, status) VALUES (1, 'done')`);

    await deleteSnapshot(db, 1, makeStorage());

    const rows = await db.all<{ id: number }>(sql`SELECT id FROM job_queue WHERE snapshot_id = 1`);
    expect(rows).toHaveLength(0);
  });

  test("removes snapshot artifact directory from disk", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, "screenshot.png"), "fake-png");

    await deleteSnapshot(db, 1, makeStorage());

    const exists = await Bun.file(join(snapshotDir, "screenshot.png")).exists();
    expect(exists).toBe(false);
  });

  test("does not throw if artifact directory is already gone", async () => {
    await expect(deleteSnapshot(db, 1, makeStorage())).resolves.toBe(true);
  });
});
