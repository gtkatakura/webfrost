import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { htmlExtractor } from "./extractors/html";
import { pdfExtractor } from "./extractors/pdf";
import { readabilityExtractor } from "./extractors/readability";
import { screenshotExtractor } from "./extractors/screenshot";
import { warcExtractor } from "./extractors/warc";
import { FetchCache } from "./fetch-cache";

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
  cache?: FetchCache,
): Promise<void> {
  const snapshotDir = join(dir, "snapshots", String(snapshotId));
  await mkdir(snapshotDir, { recursive: true });

  // Use the provided shared cache, or create a one-shot cache for this run
  const fetchCache = cache ?? new FetchCache();

  function markFailed() {
    try {
      db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(
        snapshotId,
      );
      db.query<null, [number]>("UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?").run(
        snapshotId,
      );
    } catch {
      // DB unavailable (e.g. closed after test cleanup) — best effort
    }
  }

  let cached: Awaited<ReturnType<FetchCache["get"]>>;
  try {
    cached = await fetchCache.get(url);
  } catch {
    markFailed();
    return;
  }

  if (!cached.status || cached.status >= 400) {
    markFailed();
    return;
  }

  const { html, headers, status, statusText } = cached;

  // Launch Playwright once for all Playwright-dependent extractors.
  // A single page.goto() is shared — no duplicate browser navigations per snapshot.
  let page: import("playwright").Page | undefined;
  let browser: import("playwright").Browser | undefined;
  try {
    const pw = await import("playwright");
    browser = await pw.chromium.launch();
    page = await browser.newPage();
    await page.goto(url, { timeout: 30_000, waitUntil: "load" });
  } catch {
    // Playwright unavailable or navigation failed — PDF will be skipped
    await browser?.close();
    browser = undefined;
    page = undefined;
  }

  try {
    // Run all extractors in parallel — partial failure is non-fatal
    await Promise.allSettled([
      htmlExtractor(db, snapshotId, html),
      warcExtractor(db, snapshotId, url, headers, status, statusText, html, snapshotDir),
      readabilityExtractor(db, snapshotId, url, html),
      page ? pdfExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
      page ? screenshotExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
    ]);
  } finally {
    await browser?.close();
  }

  try {
    db.query<null, [number]>("UPDATE snapshots SET status = 'done' WHERE id = ?").run(snapshotId);
    db.query<null, [number]>("UPDATE job_queue SET status = 'done' WHERE snapshot_id = ?").run(
      snapshotId,
    );
  } catch {
    // DB unavailable — best effort
  }
}

/** Convenience: create a snapshot and run the full pipeline synchronously. */
export async function addUrl(db: Database, url: string, dir: string): Promise<number> {
  const snapshotId = createSnapshot(db, url);
  await runPipeline(db, snapshotId, url, dir);
  return snapshotId;
}
