import type Database from "bun:sqlite";
import type { StorageBackend } from "./storage";

// Extractors that store a backend ref as content rather than inline text
const FILE_BACKED_EXTRACTORS = new Set([
  "screenshot",
  "pdf",
  "warc",
  "dom-snapshot",
  "singlefile",
  "media",
]);

export interface Stats {
  snapshotCount: number;
  storageBytes: number;
  storageByExtractor: Record<string, number>;
  successRate: number;
  activeScheduleCount: number;
  failedToday: number;
}

export async function getStats(db: Database, storage: StorageBackend): Promise<Stats> {
  // Total snapshot count
  const snapshotRow = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM snapshots")
    .get();
  const snapshotCount = snapshotRow?.count ?? 0;

  // Storage: iterate archive_results, resolve real file sizes for file-backed extractors
  const archiveRows = db
    .query<{ extractor: string; content: string | null }, []>(
      "SELECT extractor, content FROM archive_results",
    )
    .all();

  const storageByExtractor: Record<string, number> = {};
  await Promise.all(
    archiveRows.map(async (row) => {
      if (!row.content) return;
      let bytes: number;
      if (FILE_BACKED_EXTRACTORS.has(row.extractor)) {
        bytes = await storage.fileSize(row.content);
      } else {
        bytes = row.content.length;
      }
      storageByExtractor[row.extractor] = (storageByExtractor[row.extractor] ?? 0) + bytes;
    }),
  );

  const storageBytes = Object.values(storageByExtractor).reduce((a, b) => a + b, 0);

  // Success rate over last 30 days (snapshots that have finished — pending excluded)
  const successRow = db
    .query<{ done: number | null; total: number | null }, []>(`
      SELECT
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS total
      FROM snapshots
      WHERE created_at >= datetime('now', '-30 days')
    `)
    .get();
  const done = successRow?.done ?? 0;
  const total = successRow?.total ?? 0;
  const successRate = total > 0 ? Math.round((done / total) * 10000) / 100 : 0;

  // Active schedule count (no paused concept in schema — all rows are active)
  const scheduleRow = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schedules")
    .get();
  const activeScheduleCount = scheduleRow?.count ?? 0;

  // Snapshots that failed today (UTC day boundary)
  const failedRow = db
    .query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM snapshots
      WHERE status = 'failed'
        AND created_at >= date('now')
    `)
    .get();
  const failedToday = failedRow?.count ?? 0;

  return {
    snapshotCount,
    storageBytes,
    storageByExtractor,
    successRate,
    activeScheduleCount,
    failedToday,
  };
}
