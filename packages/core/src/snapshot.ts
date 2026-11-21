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

export async function getSnapshot(db: Db, id: number): Promise<SnapshotDetail | null> {
  const snapshot = await db.get<{ id: number; url: string; status: string; created_at: string }>(
    sql`SELECT id, url, status, created_at FROM snapshots WHERE id = ${id}`,
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
 * artifact files on disk/S3.
 * Returns true if the snapshot was found and deleted, false if not found.
 */
export async function deleteSnapshot(
  db: Db,
  id: number,
  storage: StorageBackend,
): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    const exists = await tx.get<{ id: number }>(sql`SELECT id FROM snapshots WHERE id = ${id}`);
    if (!exists) return false;

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
