import type Database from "bun:sqlite";
import { removeFromIndex } from "./search";
import type { StorageBackend } from "./storage";

interface ArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  created_at: string;
  duration_ms: number | null;
  error: string | null;
}

export interface SnapshotDetail {
  id: number;
  url: string;
  status: string;
  created_at: string;
  archiveResults: ArchiveResult[];
}

export function getSnapshot(db: Database, id: number): SnapshotDetail | null {
  const snapshot = db
    .query<{ id: number; url: string; status: string; created_at: string }, [number]>(
      "SELECT id, url, status, created_at FROM snapshots WHERE id = ?",
    )
    .get(id);

  if (!snapshot) return null;

  const archiveResults = db
    .query<ArchiveResult, [number]>(
      "SELECT id, extractor, content, created_at, duration_ms, error FROM archive_results WHERE snapshot_id = ? ORDER BY id",
    )
    .all(id);

  return { ...snapshot, archiveResults };
}

/**
 * Delete a snapshot and all related data (archive results, job queue entries,
 * snapshot-tag associations) plus artifact files on disk/S3.
 * Returns true if the snapshot was found and deleted, false if not found.
 */
export async function deleteSnapshot(
  db: Database,
  id: number,
  storage: StorageBackend,
): Promise<boolean> {
  const exists = db
    .query<{ id: number }, [number]>("SELECT id FROM snapshots WHERE id = ?")
    .get(id);

  if (!exists) return false;

  // archive_results and job_queue lack ON DELETE CASCADE — delete manually
  db.query<null, [number]>("DELETE FROM archive_results WHERE snapshot_id = ?").run(id);
  db.query<null, [number]>("DELETE FROM job_queue WHERE snapshot_id = ?").run(id);
  // snapshot_tags has ON DELETE CASCADE but explicit delete is fine
  removeFromIndex(db, id);
  db.query<null, [number]>("DELETE FROM snapshots WHERE id = ?").run(id);

  // Remove artifact files (best effort — don't fail if already gone)
  await storage.deleteAll(id);

  return true;
}
