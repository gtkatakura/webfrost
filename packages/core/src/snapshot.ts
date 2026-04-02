import type Database from "bun:sqlite";

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
