import { sql } from "kysely";
import type { Db } from "./db";
import type { Failure } from "./failure";
import type { StorageBackend } from "./storage";

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
  failure?: Failure,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const fence = lease === undefined ? sql`` : sql`AND lease_token = ${lease}`;
    const changed = await tx.run(
      sql`UPDATE job_queue SET status = ${status}, heartbeat_at = ${tx.now()} WHERE snapshot_id = ${snapshotId} ${fence}`,
    );
    if (lease !== undefined && changed === 0) return false;
    if (status !== "running") {
      // A failed run says why; a run that finished clears what an earlier failure left.
      const why = status === "failed" ? (failure ?? NO_OUTPUT) : null;
      await tx.run(
        sql`UPDATE snapshots
            SET status = ${status}, failure_category = ${why?.category ?? null}, failure_detail = ${why?.detail ?? null}
            WHERE id = ${snapshotId}`,
      );
    }
    return true;
  });
}

const NO_OUTPUT: Failure = { category: "no_output", detail: "no format could be archived" };

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
/** A run tried to write after its job passed to another worker; nothing of it is kept. */
export class LeaseLostError extends Error {
  constructor(snapshotId: number) {
    super(`snapshot ${snapshotId}: this run's job was taken over by another worker`);
    this.name = "LeaseLostError";
  }
}

/**
 * Storage for one leased run of a snapshot. Files prepared with `localPath` are written in a stage
 * of the run's own and put in place by `finalize` only while the run still holds its lease (checked
 * just before); `putText`/`putBytes` check it too. A run that lost its lease (stalled, then
 * adopted by another worker) gets a LeaseLostError and leaves the other run's files alone.
 * `discard()` removes whatever the run staged and never finalized.
 */
export function fencedStorage(
  db: Db,
  inner: StorageBackend,
  snapshotId: number,
  lease: string,
): StorageBackend & { discard(): Promise<void> } {
  const stillHolds = async () => {
    if (!(await db.transaction((tx) => holdsLease(tx, snapshotId, lease)))) {
      throw new LeaseLostError(snapshotId);
    }
  };
  return {
    localPath: (id, filename) => inner.localPath(id, filename, lease),
    finalize: async (id, filename) => {
      await stillHolds();
      return inner.finalize(id, filename, lease);
    },
    putText: async (id, filename, content) => {
      await stillHolds();
      return inner.putText(id, filename, content);
    },
    putBytes: async (id, filename, content) => {
      await stillHolds();
      return inner.putBytes(id, filename, content);
    },
    getBytes: (ref) => inner.getBytes(ref),
    getStream: (ref) => inner.getStream(ref),
    fileExists: (ref) => inner.fileExists(ref),
    fileSize: (ref) => inner.fileSize(ref),
    deleteAll: (id) => inner.deleteAll(id),
    validateRef: (ref) => inner.validateRef(ref),
    presignedDownloadUrl: (ref, expiresIn, response) =>
      inner.presignedDownloadUrl(ref, expiresIn, response),
    discardStage: (id, stage) => inner.discardStage(id, stage),
    discard: () => inner.discardStage(snapshotId, lease),
  };
}

export function newLeaseToken(): string {
  return crypto.randomUUID();
}
