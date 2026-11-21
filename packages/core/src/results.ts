import { sql } from "kysely";
import type { Db } from "./db";

/**
 * Lease fencing.
 *
 * Every job carries a `lease_token`, issued when the job is created and replaced
 * whenever another worker adopts it (`JobRunner.recoverPending`). A pipeline that
 * was presumed dead — its heartbeat went stale, say, because the process stalled —
 * may still be running; its writes name the token it was started with and are
 * dropped once the job has a new owner, so it cannot overwrite the new run's
 * status or add results to it.
 *
 * Lock order is job_queue row, then snapshots/archive_results, in every fenced
 * write and in recovery, so the two cannot deadlock on PostgreSQL or MySQL.
 */

/** Lock the job row and check that `lease` still owns it. No lease means unfenced. */
async function holdsLease(tx: Db, snapshotId: number, lease: string | undefined): Promise<boolean> {
  if (lease === undefined) return true;
  const row = await tx.get<{ id: number }>(
    sql`SELECT id FROM job_queue WHERE snapshot_id = ${snapshotId} AND lease_token = ${lease} ${tx.forShare()}`,
  );
  return row !== null;
}

export interface ResultRecord {
  extractor: string;
  /** Inline data, or the storage reference of a file-backed result. */
  content?: string | null;
  error?: string | null;
  durationMs?: number | null;
  /** Bytes of the stored file / inline content, so stats never need to ask storage. */
  sizeBytes?: number | null;
}

/**
 * Insert an `archive_results` row. With a `lease`, the row is written only while
 * that lease still owns the job; returns false when it was dropped.
 */
export async function recordResult(
  db: Db,
  snapshotId: number,
  record: ResultRecord,
  lease?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await holdsLease(tx, snapshotId, lease))) return false;
    await tx.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content, error, duration_ms, size_bytes, created_at)
          VALUES (${snapshotId}, ${record.extractor}, ${record.content ?? null}, ${record.error ?? null},
                  ${record.durationMs ?? null}, ${record.sizeBytes ?? null}, ${tx.now()})`,
    );
    return true;
  });
}

/**
 * Record a pipeline status on the job (and, unless it is `running`, on the
 * snapshot), refreshing the heartbeat. Returns false — and writes nothing — when
 * `lease` no longer owns the job.
 */
export async function setJobStatus(
  db: Db,
  snapshotId: number,
  status: "running" | "done" | "failed",
  lease?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const fence = lease === undefined ? sql`` : sql`AND lease_token = ${lease}`;
    const changed = await tx.run(
      sql`UPDATE job_queue SET status = ${status}, heartbeat_at = ${tx.now()} WHERE snapshot_id = ${snapshotId} ${fence}`,
    );
    if (lease !== undefined && changed === 0) return false;
    if (status !== "running") {
      await tx.run(sql`UPDATE snapshots SET status = ${status} WHERE id = ${snapshotId}`);
    }
    return true;
  });
}

/** Refresh a job's heartbeat (only while `lease` owns it). Never throws. */
export async function touchJob(db: Db, snapshotId: number, lease?: string): Promise<void> {
  try {
    const fence = lease === undefined ? sql`` : sql`AND lease_token = ${lease}`;
    await db.run(
      sql`UPDATE job_queue SET heartbeat_at = ${db.now()} WHERE snapshot_id = ${snapshotId} ${fence}`,
    );
  } catch {
    // Lease refresh is best effort; the pipeline's own writes report real problems.
  }
}

/** A fresh lease token. */
export function newLeaseToken(): string {
  return crypto.randomUUID();
}
