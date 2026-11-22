import type { Db } from "../db";
import { recordResult } from "../results";
import { envInt } from "../ssrf-guard";
import type { StorageBackend } from "../storage";

/**
 * Chromium cannot paint a screenshot much taller than this; a longer page (a long Wikipedia article) is cut
 * here instead of failing.
 */
export const MAX_SCREENSHOT_HEIGHT = 10_000;

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
  // The thumbnail first: the first screen at half size (640 px wide is a card even on a 2x screen), as WebP
  // straight from Chromium. Cheap, and it exists even for a page whose full shot fails.
  const thumbPath = await storage.localPath(snapshotId, "thumbnail.webp");
  const width = page.viewportSize()?.width ?? 1280;
  const viewHeight = page.viewportSize()?.height ?? 720;
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = (await cdp.send("Page.captureScreenshot", {
      format: "webp",
      quality: 70,
      clip: { x: 0, y: 0, width, height: viewHeight, scale: 0.5 },
    })) as { data: string };
    await Bun.write(thumbPath, Buffer.from(data, "base64"));
  } finally {
    await cdp.detach().catch(() => {});
  }
  signal?.throwIfAborted();
  const thumbSize = Bun.file(thumbPath).size;
  const thumbRef = await storage.finalize(snapshotId, "thumbnail.webp");
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
  // Allow the extractor's own time, not Playwright's 30 s: a heavy page shares the browser with the others.
  const timeout = Math.max(1_000, envInt("WEBFROST_EXTRACTOR_TIMEOUT_MS", 60_000) - 5_000);
  if (height > MAX_SCREENSHOT_HEIGHT) {
    // fullPage would lay out and paint the whole page (40000 px for a long article: 18 s and more) before the
    // clip cuts it. A viewport as tall as the limit paints only what is kept: about half a second. The page is
    // shared with the other extractors, so the viewport goes back right after.
    const viewport = page.viewportSize() ?? { width, height: 720 };
    await page.setViewportSize({ width, height: MAX_SCREENSHOT_HEIGHT });
    try {
      await page.screenshot({ path: localPath, timeout });
    } finally {
      await page.setViewportSize(viewport).catch(() => {});
    }
  } else {
    await page.screenshot({ path: localPath, fullPage: true, timeout });
  }
  // The pipeline gave up on this extractor (timeout): do not record a late result.
  signal?.throwIfAborted();

  // Measured before finalize(): an S3 backend uploads the file and removes the local copy.
  const sizeBytes = Bun.file(localPath).size;
  const ref = await storage.finalize(snapshotId, "screenshot.png");

  await recordResult(db, snapshotId, { extractor: "screenshot", content: ref, sizeBytes }, lease);
}
