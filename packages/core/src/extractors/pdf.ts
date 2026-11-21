import type { Db } from "../db";
import { recordResult } from "../results";
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
  db: Db,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
  signal?: AbortSignal,
  lease?: string,
): Promise<void> {
  const localPath = await storage.localPath(snapshotId, "page.pdf");
  await page.pdf({ path: localPath });
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  // Measured before finalize(): an S3 backend uploads the file and removes the local copy.
  const sizeBytes = Bun.file(localPath).size;
  const ref = await storage.finalize(snapshotId, "page.pdf");

  await recordResult(db, snapshotId, { extractor: "pdf", content: ref, sizeBytes }, lease);
}
