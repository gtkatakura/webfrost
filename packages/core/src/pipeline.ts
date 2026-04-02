import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { htmlExtractor } from "./extractors/html";
import { pdfExtractor } from "./extractors/pdf";
import { readabilityExtractor } from "./extractors/readability";
import { warcExtractor } from "./extractors/warc";

/** Insert a snapshot row and enqueue a job. Returns the new snapshot id. */
export function createSnapshot(db: Database, url: string): number {
  const row = db
    .query<{ id: number }, [string]>(
      "INSERT INTO snapshots (url, status) VALUES (?, 'pending') RETURNING id",
    )
    .get(url);

  if (!row) throw new Error("Failed to insert snapshot");

  db.query<null, [number]>("INSERT INTO job_queue (snapshot_id, status) VALUES (?, 'running')").run(
    row.id,
  );

  return row.id;
}

/** Run the full archive pipeline for an existing snapshot id. */
export async function runPipeline(
  db: Database,
  snapshotId: number,
  url: string,
  dir: string,
): Promise<void> {
  const snapshotDir = join(dir, "snapshots", String(snapshotId));
  await mkdir(snapshotDir, { recursive: true });

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(snapshotId);
    db.query<null, [number]>("UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?").run(
      snapshotId,
    );
    return;
  }

  if (!response.ok) {
    db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(snapshotId);
    db.query<null, [number]>("UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?").run(
      snapshotId,
    );
    return;
  }

  const html = await response.text();
  const { headers, status, statusText } = response;

  // Run all extractors in parallel — partial failure is non-fatal
  await Promise.allSettled([
    htmlExtractor(db, snapshotId, html),
    warcExtractor(db, snapshotId, url, headers, status, statusText, html, snapshotDir),
    readabilityExtractor(db, snapshotId, url, html),
    pdfExtractor(db, snapshotId, url, snapshotDir),
  ]);

  db.query<null, [number]>("UPDATE snapshots SET status = 'done' WHERE id = ?").run(snapshotId);
  db.query<null, [number]>("UPDATE job_queue SET status = 'done' WHERE snapshot_id = ?").run(
    snapshotId,
  );
}

/** Convenience: create a snapshot and run the full pipeline synchronously. */
export async function addUrl(db: Database, url: string, dir: string): Promise<number> {
  const snapshotId = createSnapshot(db, url);
  await runPipeline(db, snapshotId, url, dir);
  return snapshotId;
}
