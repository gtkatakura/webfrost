import { sql } from "kysely";
import type { Db } from "./db";

export interface ImportRecord {
  id: string;
  source_url: string | null;
  format: string;
  queued: number;
  skipped: number;
  created_at: string;
}

/** Record a completed import operation in the imports history table. */
export async function recordImport(
  db: Db,
  record: Omit<ImportRecord, "created_at">,
): Promise<void> {
  await db.run(
    sql`INSERT INTO imports (id, source_url, format, queued, skipped, created_at) VALUES (${record.id}, ${record.source_url}, ${record.format}, ${record.queued}, ${record.skipped}, ${db.now()})`,
  );
}

/** List the most recent import records, newest first, skipping the first `offset`. */
export async function listImports(db: Db, limit = 50, offset = 0): Promise<ImportRecord[]> {
  return db.all<ImportRecord>(
    sql`SELECT id, source_url, format, queued, skipped, created_at FROM imports ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
  );
}

/** How many import records there are. */
export async function countImports(db: Db): Promise<number> {
  const row = await db.get<{ count: number | string }>(sql`SELECT COUNT(*) AS count FROM imports`);
  return Number(row?.count ?? 0);
}
