import type { Db } from "../db";
import { recordResult } from "../results";
import type { StorageBackend } from "../storage";

/**
 * Chromium cannot paint a screenshot much taller than this; a longer page (a long Wikipedia article) is cut
 * here instead of failing.
 */
export const MAX_SCREENSHOT_HEIGHT = 16_000;

/**
 * Capture a full-page PNG screenshot from an already-navigated Playwright page, and a small JPEG of what
 * the first screen shows (`thumbnail`), which lists and cards load instead of the full page.
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
  // The thumbnail first: one screen, cheap, and it exists even for a page too long for the full shot.
  const thumbPath = await storage.localPath(snapshotId, "thumbnail.jpg");
  await page.screenshot({ path: thumbPath, type: "jpeg", quality: 60 });
  signal?.throwIfAborted();
  const thumbSize = Bun.file(thumbPath).size;
  const thumbRef = await storage.finalize(snapshotId, "thumbnail.jpg");
  await recordResult(
    db,
    snapshotId,
    { extractor: "thumbnail", content: thumbRef, sizeBytes: thumbSize },
    lease,
  );

  const localPath = await storage.localPath(snapshotId, "screenshot.png");
  const height = await page
    .evaluate(() => document.documentElement.scrollHeight)
    .catch(() => MAX_SCREENSHOT_HEIGHT);
  const width = page.viewportSize()?.width ?? 1280;
  await page.screenshot(
    height > MAX_SCREENSHOT_HEIGHT
      ? {
          path: localPath,
          fullPage: true,
          clip: { x: 0, y: 0, width, height: MAX_SCREENSHOT_HEIGHT },
        }
      : { path: localPath, fullPage: true },
  );
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  // Measured before finalize(): an S3 backend uploads the file and removes the local copy.
  const sizeBytes = Bun.file(localPath).size;
  const ref = await storage.finalize(snapshotId, "screenshot.png");

  await recordResult(db, snapshotId, { extractor: "screenshot", content: ref, sizeBytes }, lease);
}
