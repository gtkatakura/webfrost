import type Database from "bun:sqlite";

export interface Snapshot {
  id: number;
  url: string;
  status: string;
  created_at: string;
}

export interface SnapshotWithExtractors extends Snapshot {
  extractors: string[];
}

export function listSnapshots(db: Database): Snapshot[] {
  return db
    .query<Snapshot, []>("SELECT id, url, status, created_at FROM snapshots ORDER BY id")
    .all();
}

export function listSnapshotsWithExtractors(db: Database): SnapshotWithExtractors[] {
  const rows = db
    .query<
      {
        id: number;
        url: string;
        status: string;
        created_at: string;
        extractor_names: string | null;
      },
      []
    >(
      `SELECT s.id, s.url, s.status, s.created_at,
         GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names
       FROM snapshots s
       LEFT JOIN archive_results ar ON ar.snapshot_id = s.id
       GROUP BY s.id
       ORDER BY s.id`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    status: r.status,
    created_at: r.created_at,
    extractors: r.extractor_names ? r.extractor_names.split(",") : [],
  }));
}
