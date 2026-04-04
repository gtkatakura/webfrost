import type Database from "bun:sqlite";

export interface ImportRecord {
  id: string;
  source_url: string | null;
  format: string;
  queued: number;
  skipped: number;
  created_at: string;
}

/** Record a completed import operation in the imports history table. */
export function recordImport(db: Database, record: Omit<ImportRecord, "created_at">): void {
  db.query<null, [string, string | null, string, number, number]>(
    "INSERT INTO imports (id, source_url, format, queued, skipped) VALUES (?, ?, ?, ?, ?)",
  ).run(record.id, record.source_url, record.format, record.queued, record.skipped);
}

/** List the most recent import records, newest first. */
export function listImports(db: Database, limit = 50): ImportRecord[] {
  return db
    .query<ImportRecord, [number]>(
      "SELECT id, source_url, format, queued, skipped, created_at FROM imports ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit);
}
