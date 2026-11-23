import { sql } from "kysely";
import { FILE_BACKED_EXTRACTORS } from "./database/migrations";
import type { Db } from "./db";
import type { StorageBackend } from "./storage";

const FILE_BACKED = new Set<string>(FILE_BACKED_EXTRACTORS);

export interface Stats {
  snapshotCount: number;
  storageBytes: number;
  storageByExtractor: Record<string, number>;
  successRate: number;
  activeScheduleCount: number;
  failedToday: number;
}

/** Storage lookups in flight at once while measuring legacy rows. */
const BACKFILL_CONCURRENCY = 16;

/**
 * Measure results whose size is not stored yet — rows written before sizes were
 * recorded (archives from before schema version 3) — and store it, so storage is
 * asked about each artifact at most once. Inline results were measured by the
 * migration; a file the backend reports as missing counts as 0 bytes. A lookup
 * that fails leaves the row unmeasured, so a later call tries it again instead of
 * recording a transient error as 0 bytes for good. Lookups run a few at a time:
 * an archive can hold thousands of artifacts, and a storage service throttles.
 */
async function backfillSizes(db: Db, storage: StorageBackend): Promise<void> {
  const missing = await db.all<{ id: number; extractor: string; content: string }>(
    sql`SELECT id, extractor, content FROM archive_results
        WHERE size_bytes IS NULL AND error IS NULL AND content IS NOT NULL AND content <> ''`,
  );
  if (missing.length === 0) return;
  const sizes: { id: number; bytes: number }[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < missing.length) {
      const row = missing[next++] as (typeof missing)[number];
      try {
        const bytes = FILE_BACKED.has(row.extractor)
          ? await storage.fileSize(row.content)
          : Buffer.byteLength(row.content, "utf8");
        sizes.push({ id: row.id, bytes });
      } catch {
        // Not measured now; size_bytes stays NULL and the next call retries.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, missing.length) }, worker));
  if (sizes.length === 0) return;
  await db.transaction(async (tx) => {
    for (const { id, bytes } of sizes) {
      await tx.run(sql`UPDATE archive_results SET size_bytes = ${bytes} WHERE id = ${id}`);
    }
  });
}

export async function getStats(db: Db, storage: StorageBackend): Promise<Stats> {
  // Total snapshot count
  const snapshotRow = await db.get<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM snapshots WHERE status <> 'importing'`,
  );
  const snapshotCount = Number(snapshotRow?.count ?? 0);

  // Storage: sizes are recorded when results are written; only legacy rows need measuring.
  await backfillSizes(db, storage);
  const sizeRows = await db.all<{ extractor: string; bytes: number | null }>(
    sql`SELECT extractor, SUM(size_bytes) AS bytes FROM archive_results
        WHERE error IS NULL AND content IS NOT NULL AND content <> ''
        GROUP BY extractor`,
  );
  const storageByExtractor: Record<string, number> = {};
  for (const row of sizeRows) storageByExtractor[row.extractor] = Number(row.bytes ?? 0);

  const storageBytes = Object.values(storageByExtractor).reduce((a, b) => a + b, 0);

  // Success rate over last 30 days (snapshots that have finished — pending excluded)
  const successRow = await db.get<{ done: number | null; total: number | null }>(
    sql`SELECT
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN status NOT IN ('pending', 'importing') THEN 1 ELSE 0 END) AS total
        FROM snapshots
        WHERE created_at >= ${db.ago(30 * 24 * 60 * 60)}`,
  );
  const done = Number(successRow?.done ?? 0);
  const total = Number(successRow?.total ?? 0);
  const successRate = total > 0 ? Math.round((done / total) * 10000) / 100 : 0;

  // Active schedule count (excludes paused schedules)
  const scheduleRow = await db.get<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM schedules WHERE paused = 0`,
  );
  const activeScheduleCount = Number(scheduleRow?.count ?? 0);

  // Snapshots that failed today (UTC day boundary)
  const failedRow = await db.get<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM snapshots
        WHERE status = 'failed'
          AND created_at >= ${db.today()}`,
  );
  const failedToday = Number(failedRow?.count ?? 0);

  return {
    snapshotCount,
    storageBytes,
    storageByExtractor,
    successRate,
    activeScheduleCount,
    failedToday,
  };
}
