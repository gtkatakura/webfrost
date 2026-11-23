import { sql } from "kysely";
import type { Db } from "./db";
import { removeFromIndex } from "./search";
import type { StorageBackend } from "./storage";

interface ArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  created_at: string;
  duration_ms: number | null;
  error: string | null;
  /** Bytes of the stored file (or of the inline content); null until measured. */
  size_bytes: number | null;
}

export interface SnapshotDetail {
  id: number;
  url: string;
  status: string;
  created_at: string;
  archiveResults: ArchiveResult[];
}

/**
 * Status of a snapshot whose bundle import is still copying files. Such a snapshot has no
 * results yet: it is left out of lists, details and stats, cannot be retried or deleted, and
 * the job recovery sweep ignores it. See bundle.ts.
 */
export const IMPORTING_STATUS = "importing";

/**
 * The snapshot cannot be changed right now: a bundle import is still writing it, or its
 * pipeline is still running (`pending`).
 */
export class SnapshotBusyError extends Error {
  constructor(
    id: number,
    readonly reason: "importing" | "archiving" = "importing",
  ) {
    super(`snapshot ${id} is being ${reason === "importing" ? "imported" : "archived"}`);
    this.name = "SnapshotBusyError";
  }
}

/** A snapshot, or null when it does not exist or is still being imported. */
export async function getSnapshot(db: Db, id: number): Promise<SnapshotDetail | null> {
  const snapshot = await db.get<{ id: number; url: string; status: string; created_at: string }>(
    sql`SELECT id, url, status, created_at FROM snapshots WHERE id = ${id} AND status <> ${IMPORTING_STATUS}`,
  );

  if (!snapshot) return null;

  const archiveResults = await db.all<ArchiveResult>(
    sql`SELECT id, extractor, content, created_at, duration_ms, error, size_bytes FROM archive_results WHERE snapshot_id = ${id} ORDER BY id`,
  );

  return { ...snapshot, archiveResults };
}

/**
 * Delete a snapshot and all related data (archive results, job queue entries,
 * snapshot-tag associations, search index entry) in one transaction, then its
 * artifact files on disk/S3. A snapshot still `pending` (being archived) or `importing`
 * throws SnapshotBusyError.
 * Returns true if the snapshot was found and deleted, false if not found.
 */
export async function deleteSnapshot(
  db: Db,
  id: number,
  storage: StorageBackend,
): Promise<boolean> {
  return removeSnapshot(db, id, storage, false);
}

/**
 * deleteSnapshot, with the import's own cleanup as the one caller allowed to remove a
 * snapshot that is still `importing` (`force`). Throws SnapshotBusyError otherwise.
 */
export async function removeSnapshot(
  db: Db,
  id: number,
  storage: StorageBackend,
  force: boolean,
): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    // Lock order: job_queue first, then snapshots, as in JobRunner.retry and fenced writes.
    await tx.run(
      sql`SELECT snapshot_id FROM job_queue WHERE snapshot_id = ${id} ${tx.forUpdate()}`,
    );
    const exists = await tx.get<{ id: number; status: string }>(
      sql`SELECT id, status FROM snapshots WHERE id = ${id} ${tx.forUpdate()}`,
    );
    if (!exists) return false;
    if (exists.status === IMPORTING_STATUS && !force) throw new SnapshotBusyError(id);
    // A pending snapshot has a pipeline writing files for it; deleting now would leave
    // whatever it writes next in storage with no row pointing at it. Same rule as retry.
    if (exists.status === "pending" && !force) throw new SnapshotBusyError(id, "archiving");

    // archive_results and job_queue lack ON DELETE CASCADE — delete manually
    await tx.run(sql`DELETE FROM archive_results WHERE snapshot_id = ${id}`);
    await tx.run(sql`DELETE FROM job_queue WHERE snapshot_id = ${id}`);
    // snapshot_tags has ON DELETE CASCADE but explicit delete is fine
    await tx.run(sql`DELETE FROM snapshot_tags WHERE snapshot_id = ${id}`);
    await removeFromIndex(tx, id);
    await tx.run(sql`DELETE FROM snapshots WHERE id = ${id}`);
    return true;
  });
  if (!deleted) return false;

  // Remove artifact files (best effort — don't fail if already gone). After the
  // commit: a failed delete leaves orphaned files, never rows pointing at nothing.
  await storage.deleteAll(id);

  return true;
}
