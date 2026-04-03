import type Database from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";

interface ArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  created_at: string;
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
      "SELECT id, extractor, content, created_at FROM archive_results WHERE snapshot_id = ? ORDER BY id",
    )
    .all(id);

  return { ...snapshot, archiveResults };
}

/**
 * Delete a snapshot and all related data (archive results, job queue entries,
 * snapshot-tag associations) plus artifact files on disk.
 * Returns true if the snapshot was found and deleted, false if not found.
 */
export async function deleteSnapshot(
  db: Database,
  id: number,
  snapshotsBaseDir: string,
): Promise<boolean> {
  const exists = db
    .query<{ id: number }, [number]>("SELECT id FROM snapshots WHERE id = ?")
    .get(id);

  if (!exists) return false;

  // archive_results and job_queue lack ON DELETE CASCADE — delete manually
  db.query<null, [number]>("DELETE FROM archive_results WHERE snapshot_id = ?").run(id);
  db.query<null, [number]>("DELETE FROM job_queue WHERE snapshot_id = ?").run(id);
  // snapshot_tags has ON DELETE CASCADE but explicit delete is fine
  db.query<null, [number]>("DELETE FROM snapshots WHERE id = ?").run(id);

  // Remove artifact files from disk (best effort — don't fail if already gone)
  const snapshotDir = join(snapshotsBaseDir, "snapshots", String(id));
  try {
    await rm(snapshotDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }

  return true;
}
