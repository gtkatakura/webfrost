import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { getTrashRetentionDays, setTrashRetentionDays } from "./app-settings";
import { type Db, openDb } from "./db";
import { listFailedSnapshots, listFailureDomains, summarizeFailureGroups } from "./failure-groups";
import { JobRunner } from "./jobs";
import { listSnapshotsWithExtractorsPaginated } from "./list";
import { getStats } from "./stats";
import { FilesystemBackend } from "./storage";
import {
  deleteSnapshotsForever,
  listTrash,
  purgeExpiredTrash,
  restoreSnapshots,
  trashSnapshots,
} from "./trash";

let testDir: string;
let db: Db;
let storage: FilesystemBackend;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `webfrost-trash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  storage = new FilesystemBackend(join(testDir, "snapshots"));
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

async function seed(url: string, status: string, category: string | null = null): Promise<number> {
  const id = await db.insert(
    sql`INSERT INTO snapshots (url, status, failure_category, failure_detail)
        VALUES (${url}, ${status}, ${category}, ${category ? "detail" : null})`,
  );
  // A file of its own, to see it go (or stay) with the snapshot.
  mkdirSync(join(testDir, "snapshots", String(id)), { recursive: true });
  writeFileSync(join(testDir, "snapshots", String(id), "page.html"), "x");
  return id;
}

const fileOf = (id: number) => join(testDir, "snapshots", String(id), "page.html");

describe("trash", () => {
  test("a trashed snapshot is hidden from lists, stats and failure groups, and keeps its files", async () => {
    const kept = await seed("https://a.example/", "done");
    const gone = await seed("https://gone.invalid/", "failed", "domain_not_found");

    expect(await trashSnapshots(db, [gone])).toBe(1);

    const list = await listSnapshotsWithExtractorsPaginated(db, 1, 20);
    expect(list.items.map((s) => s.id)).toEqual([kept]);
    expect((await getStats(db, storage)).snapshotCount).toBe(1);
    expect((await summarizeFailureGroups(db)).find((g) => g.id === "domain-gone")?.count).toBe(0);
    expect(existsSync(fileOf(gone))).toBe(true);
    expect((await listTrash(db, 1, 20)).items.map((s) => s.id)).toEqual([gone]);
  });

  test("restore brings it back as it was", async () => {
    const id = await seed("https://gone.invalid/", "failed", "domain_not_found");
    await trashSnapshots(db, [id]);
    expect(await restoreSnapshots(db, [id])).toBe(1);
    expect((await listTrash(db, 1, 20)).total).toBe(0);
    expect((await summarizeFailureGroups(db)).find((g) => g.id === "domain-gone")?.count).toBe(1);
  });

  test("a snapshot in the trash cannot be retried until it is restored", async () => {
    const id = await seed("https://blocked.example/", "failed", "access_denied");
    await trashSnapshots(db, [id]);
    const runner = new JobRunner({ dir: testDir });
    expect(await runner.retry(db, id)).toBe("missing");
    const row = await db.get<{ status: string }>(
      sql`SELECT status FROM snapshots WHERE id = ${id}`,
    );
    expect(row?.status).toBe("failed");
  });

  test("a snapshot being archived is not moved to the trash", async () => {
    const id = await seed("https://busy.example/", "pending");
    expect(await trashSnapshots(db, [id])).toBe(0);
  });

  test("deleting from the trash only deletes what is in it", async () => {
    const trashed = await seed("https://t.example/", "failed", "timeout");
    const notTrashed = await seed("https://n.example/", "failed", "timeout");
    await trashSnapshots(db, [trashed]);

    const result = await deleteSnapshotsForever(db, [trashed, notTrashed], storage, {
      onlyTrashed: true,
    });
    expect(result).toEqual({ deleted: 1, busy: 0 });
    expect(existsSync(fileOf(trashed))).toBe(false);
    expect(existsSync(fileOf(notTrashed))).toBe(true);
  });

  test("the sweep deletes for good only what is past the retention", async () => {
    const old = await seed("https://old.example/", "failed", "timeout");
    const recent = await seed("https://recent.example/", "failed", "timeout");
    await trashSnapshots(db, [old, recent]);
    await setTrashRetentionDays(db, 30);
    await db.run(
      sql`UPDATE snapshots SET trashed_at = ${db.ago(31 * 24 * 60 * 60)} WHERE id = ${old}`,
    );

    expect(await purgeExpiredTrash(db, storage)).toBe(1);
    expect((await listTrash(db, 1, 20)).items.map((s) => s.id)).toEqual([recent]);
    expect(existsSync(fileOf(old))).toBe(false);
    expect(existsSync(fileOf(recent))).toBe(true);
  });
});

describe("trash retention setting", () => {
  test("30 days until set; out-of-range values are refused", async () => {
    expect(await getTrashRetentionDays(db)).toBe(30);
    await setTrashRetentionDays(db, 7);
    expect(await getTrashRetentionDays(db)).toBe(7);
    await setTrashRetentionDays(db, 90);
    expect(await getTrashRetentionDays(db)).toBe(90);
    await expect(setTrashRetentionDays(db, 0)).rejects.toThrow();
    await expect(setTrashRetentionDays(db, 366)).rejects.toThrow();
    await expect(setTrashRetentionDays(db, 1.5)).rejects.toThrow();
  });
});

describe("failure groups", () => {
  test("groups by category; a page that worked before is counted, never listed as failed", async () => {
    await seed("https://mangahost4.invalid/a", "failed", "domain_not_found");
    await seed("https://mangahost4.invalid/b", "failed", "domain_not_found");
    const worked = await seed("https://mangahost4.invalid/b", "done");
    await seed("https://site.example/x", "failed", "page_not_found");
    await seed("https://so.example/q", "failed", "access_denied");
    await seed("https://old.example/", "failed", null);

    const groups = Object.fromEntries(
      (await summarizeFailureGroups(db)).map((g) => [g.id, g.count]),
    );
    expect(groups["domain-gone"]).toBe(2);
    expect(groups["page-gone"]).toBe(1);
    expect(groups.blocked).toBe(1);
    expect(groups.unknown).toBe(1);

    const domains = await listFailureDomains(db, "domain-gone");
    expect(domains?.items).toEqual([
      expect.objectContaining({ host: "mangahost4.invalid", count: 2, withWorkingSnapshot: 1 }),
    ]);
    const snapshots = await listFailedSnapshots(db, "domain-gone", "mangahost4.invalid");
    expect(snapshots?.items.map((s) => s.workingSnapshotId)).toEqual([worked, null]);
  });

  test("domains are paginated and filtered by a fragment", async () => {
    for (let i = 0; i < 5; i++)
      await seed(`https://m${i}.mangahost.invalid/`, "failed", "domain_not_found");
    await seed("https://other.invalid/", "failed", "domain_not_found");

    const page1 = await listFailureDomains(db, "domain-gone", {
      q: "MANGAHOST",
      page: 1,
      limit: 2,
    });
    const page3 = await listFailureDomains(db, "domain-gone", {
      q: "mangahost",
      page: 3,
      limit: 2,
    });
    expect(page1?.total).toBe(5);
    expect(page1?.items).toHaveLength(2);
    expect(page3?.items).toHaveLength(1);
    expect(await listFailureDomains(db, "no-such-group")).toBeNull();
  });
});
