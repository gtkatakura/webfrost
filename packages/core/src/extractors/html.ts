import type Database from "bun:sqlite";

export function htmlExtractor(db: Database, snapshotId: number, html: string): void {
  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', ?)",
  ).run(snapshotId, html);
}
