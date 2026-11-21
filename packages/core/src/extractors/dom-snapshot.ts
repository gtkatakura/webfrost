import type Database from "bun:sqlite";
import type { StorageBackend } from "../storage";

/**
 * Capture the post-JS-execution DOM from an already-navigated Playwright page.
 * Unlike the raw HTML extractor (which captures the server response), this
 * captures the live DOM after client-side JavaScript has run.
 * The page must already have called page.goto() before this extractor runs.
 *
 * Throws if the DOM cannot be read; the pipeline records that as a failed
 * extractor without failing the snapshot.
 */
export async function domSnapshotExtractor(
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
  signal?: AbortSignal,
): Promise<void> {
  const dom = await page.content();
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  const ref = await storage.putText(snapshotId, "dom.html", dom);

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'dom-snapshot', ?)",
  ).run(snapshotId, ref);
}
