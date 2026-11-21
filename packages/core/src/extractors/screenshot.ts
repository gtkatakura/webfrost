import type { Db } from "../db";
import { recordResult } from "../results";
import type { StorageBackend } from "../storage";

/**
 * Capture a full-page PNG screenshot from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.screenshot().
 *
 * Throws if the screenshot cannot be taken; the pipeline records that as a
 * failed extractor without failing the snapshot.
 */
export async function screenshotExtractor(
  db: Db,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
  signal?: AbortSignal,
  lease?: string,
): Promise<void> {
  const localPath = await storage.localPath(snapshotId, "screenshot.png");
  await page.screenshot({ path: localPath, fullPage: true });
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  // Measured before finalize(): an S3 backend uploads the file and removes the local copy.
  const sizeBytes = Bun.file(localPath).size;
  const ref = await storage.finalize(snapshotId, "screenshot.png");

  await recordResult(db, snapshotId, { extractor: "screenshot", content: ref, sizeBytes }, lease);
}
