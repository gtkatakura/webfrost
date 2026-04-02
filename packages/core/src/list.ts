import type Database from "bun:sqlite";

export interface Snapshot {
  id: number;
  url: string;
  status: string;
  created_at: string;
}

export function listSnapshots(db: Database): Snapshot[] {
  return db
    .query<Snapshot, []>("SELECT id, url, status, created_at FROM snapshots ORDER BY id")
    .all();
}
