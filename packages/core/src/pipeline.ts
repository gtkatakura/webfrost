import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { domSnapshotExtractor } from "./extractors/dom-snapshot";
import { htmlExtractor } from "./extractors/html";
import { pdfExtractor } from "./extractors/pdf";
import { readabilityExtractor } from "./extractors/readability";
import { screenshotExtractor } from "./extractors/screenshot";
import { singleFileExtractor } from "./extractors/singlefile";
import { warcExtractor } from "./extractors/warc";
import { FetchCache } from "./fetch-cache";
import { extractIndexFields, indexSnapshot } from "./search";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

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
  logger?: Logger,
): Promise<void> {
  const start = Date.now();
  const snapshotDir = join(dir, "snapshots", String(snapshotId));
  await mkdir(snapshotDir, { recursive: true });

  logger?.debug(`pipeline start snapshot=${snapshotId} url=${url}`);

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
  } catch (err) {
    logger?.error(
      `fetch failed snapshot=${snapshotId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    markFailed();
    return;
  }

  if (!cached.status || cached.status >= 400) {
    logger?.warn(`fetch error snapshot=${snapshotId} status=${cached.status ?? "none"} url=${url}`);
    markFailed();
    return;
  }

  logger?.debug(`fetch ok snapshot=${snapshotId} status=${cached.status}`);

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
    logger?.debug(`playwright navigation ok snapshot=${snapshotId}`);
  } catch (err) {
    // Playwright unavailable or navigation failed — PDF will be skipped
    logger?.debug(
      `playwright unavailable snapshot=${snapshotId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    await browser?.close();
    browser = undefined;
    page = undefined;
  }

  const extractorNames = [
    "html",
    "warc",
    "readability",
    "pdf",
    "screenshot",
    "dom-snapshot",
    "singlefile",
  ] as const;

  try {
    // Run all extractors in parallel — partial failure is non-fatal
    const results = await Promise.allSettled([
      htmlExtractor(db, snapshotId, html),
      warcExtractor(db, snapshotId, url, headers, status, statusText, html, snapshotDir),
      readabilityExtractor(db, snapshotId, url, html),
      page ? pdfExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
      page ? screenshotExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
      page ? domSnapshotExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
      page ? singleFileExtractor(db, snapshotId, snapshotDir, page) : Promise.resolve(),
    ]);
    results.forEach((result, i) => {
      const name = extractorNames[i] ?? `extractor-${i}`;
      if (result.status === "rejected") {
        logger?.warn(
          `extractor ${name} failed snapshot=${snapshotId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      } else {
        logger?.debug(`extractor ${name} ok snapshot=${snapshotId}`);
      }
    });
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

  // Index the snapshot for full-text search
  try {
    const readabilityRow = db
      .query<{ content: string | null }, [number]>(
        "SELECT content FROM archive_results WHERE snapshot_id = ? AND extractor = 'readability' LIMIT 1",
      )
      .get(snapshotId);
    const { title, textContent, tags } = extractIndexFields(
      db,
      snapshotId,
      readabilityRow?.content,
    );
    indexSnapshot(db, snapshotId, url, title, textContent, tags);
  } catch {
    // FTS indexing failure is non-fatal
  }

  logger?.debug(`pipeline done snapshot=${snapshotId} duration=${Date.now() - start}ms`);
}

/** Convenience: create a snapshot and run the full pipeline synchronously. */
export async function addUrl(
  db: Database,
  url: string,
  dir: string,
  logger?: Logger,
): Promise<number> {
  const snapshotId = createSnapshot(db, url);
  await runPipeline(db, snapshotId, url, dir, undefined, logger);
  return snapshotId;
}
