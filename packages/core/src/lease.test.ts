import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { JobRunner } from "./jobs";
import { createSnapshotJob, runPipeline } from "./pipeline";
import { recordResult, setJobStatus, touchJob } from "./results";

/**
 * Lease fencing: once another worker has adopted a job, writes from the worker
 * that held it before must have no effect. Runs on every database.
 */

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `lease-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

async function job(id: number) {
  return db.get<{ status: string; lease_token: string | null; heartbeat_at: string | null }>(
    sql`SELECT status, lease_token, heartbeat_at FROM job_queue WHERE snapshot_id = ${id}`,
  );
}

async function snapshotStatus(id: number) {
  return (await db.get<{ status: string }>(sql`SELECT status FROM snapshots WHERE id = ${id}`))
    ?.status;
}

async function resultCount(id: number): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM archive_results WHERE snapshot_id = ${id}`,
  );
  return Number(row?.n ?? 0);
}

/** Make a job look abandoned: its heartbeat is far older than the lease. */
async function expireHeartbeat(id: number): Promise<void> {
  await db.run(sql`UPDATE job_queue SET heartbeat_at = ${db.ago(3600)} WHERE snapshot_id = ${id}`);
}

describe("lease fencing", () => {
  test("a new job is issued a lease token", async () => {
    const { snapshotId, lease } = await createSnapshotJob(db, "https://example.com/");
    expect(lease).toMatch(/^[0-9a-f-]{36}$/);
    expect((await job(snapshotId))?.lease_token).toBe(lease);
  });

  test("writes under a superseded lease are dropped; the current owner's go through", async () => {
    const { snapshotId, lease: stale } = await createSnapshotJob(db, "https://example.com/");
    // Another worker adopts the job.
    await db.run(
      sql`UPDATE job_queue SET lease_token = 'new-owner' WHERE snapshot_id = ${snapshotId}`,
    );

    expect(await setJobStatus(db, snapshotId, "done", stale)).toBe(false);
    expect(
      await recordResult(db, snapshotId, { extractor: "html", content: "<p>late</p>" }, stale),
    ).toBe(false);
    expect(await snapshotStatus(snapshotId)).toBe("pending");
    expect((await job(snapshotId))?.status).toBe("pending");
    expect(await resultCount(snapshotId)).toBe(0);

    expect(
      await recordResult(db, snapshotId, { extractor: "html", content: "<p>ok</p>" }, "new-owner"),
    ).toBe(true);
    expect(await setJobStatus(db, snapshotId, "done", "new-owner")).toBe(true);
    expect(await snapshotStatus(snapshotId)).toBe("done");
    expect(await resultCount(snapshotId)).toBe(1);
  });

  test("a stale heartbeat does not renew a lease the worker no longer holds", async () => {
    const { snapshotId, lease: stale } = await createSnapshotJob(db, "https://example.com/");
    await expireHeartbeat(snapshotId);
    await db.run(
      sql`UPDATE job_queue SET lease_token = 'new-owner' WHERE snapshot_id = ${snapshotId}`,
    );
    const before = (await job(snapshotId))?.heartbeat_at;

    await touchJob(db, snapshotId, stale);
    expect((await job(snapshotId))?.heartbeat_at).toBe(before ?? null);

    await touchJob(db, snapshotId, "new-owner");
    expect((await job(snapshotId))?.heartbeat_at).not.toBe(before ?? null);
  });

  test("a pipeline started under a superseded lease writes nothing", async () => {
    const { snapshotId } = await createSnapshotJob(db, "http://127.0.0.1:1/");
    await runPipeline(
      db,
      snapshotId,
      "http://127.0.0.1:1/",
      testDir,
      undefined,
      undefined,
      undefined,
      {
        lease: "superseded",
        throttle: false,
      },
    );
    expect(await snapshotStatus(snapshotId)).toBe("pending");
    expect((await job(snapshotId))?.status).toBe("pending");
    expect(await resultCount(snapshotId)).toBe(0);
  });

  test("recovery re-issues the lease, so the previous owner is fenced off", async () => {
    // A URL the SSRF guard refuses: the adopted run fails at once, without network.
    const url = "http://127.0.0.1:1/";
    const { snapshotId, lease: original } = await createSnapshotJob(db, url);
    await recordResult(db, snapshotId, { extractor: "html", content: "partial" }, original);
    await expireHeartbeat(snapshotId);

    const runner = new JobRunner({ dir: testDir });
    expect(await runner.recoverPending()).toBe(1);
    const adopted = (await job(snapshotId))?.lease_token;
    expect(adopted).toBeTruthy();
    expect(adopted).not.toBe(original);
    await runner.onIdle();
    // The adopted run discarded the partial result and recorded its own outcome.
    expect(await snapshotStatus(snapshotId)).toBe("failed");
    expect(await resultCount(snapshotId)).toBe(0);

    // The original worker wakes up and tries to finish: nothing changes.
    expect(await setJobStatus(db, snapshotId, "done", original)).toBe(false);
    expect(
      await recordResult(db, snapshotId, { extractor: "html", content: "late" }, original),
    ).toBe(false);
    expect(await snapshotStatus(snapshotId)).toBe("failed");
    expect(await resultCount(snapshotId)).toBe(0);
  });

  test("workers recovering at the same time split the orphans instead of sharing them", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const { snapshotId } = await createSnapshotJob(db, `http://127.0.0.${i + 1}:1/`);
      await expireHeartbeat(snapshotId);
      ids.push(snapshotId);
    }

    const runners = Array.from({ length: 4 }, () => new JobRunner({ dir: testDir }));
    const adopted = await Promise.all(runners.map((r) => r.recoverPending()));
    expect(adopted.reduce((a, b) => a + b, 0)).toBe(ids.length);
    await Promise.all(runners.map((r) => r.onIdle()));

    const attempts = await db.all<{ attempts: number }>(
      sql`SELECT attempts FROM job_queue ORDER BY snapshot_id`,
    );
    // Each orphan was adopted exactly once.
    expect(attempts.map((a) => Number(a.attempts))).toEqual(ids.map(() => 1));
  }, 30_000);
});
