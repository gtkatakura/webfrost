import type Database from "bun:sqlite";
import type { StorageBackend } from "../storage";

/**
 * Generate a PDF from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.pdf().
 *
 * Throws if the PDF cannot be produced; the pipeline records that as a failed
 * extractor without failing the snapshot.
 */
export async function pdfExtractor(
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
  signal?: AbortSignal,
): Promise<void> {
  const localPath = await storage.localPath(snapshotId, "page.pdf");
  await page.pdf({ path: localPath });
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  const ref = await storage.finalize(snapshotId, "page.pdf");

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'pdf', ?)",
  ).run(snapshotId, ref);
}
