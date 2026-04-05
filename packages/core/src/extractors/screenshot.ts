import type Database from "bun:sqlite";
import type { StorageBackend } from "../storage";

/**
 * Capture a full-page PNG screenshot from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.screenshot().
 */
export async function screenshotExtractor(
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
): Promise<void> {
  const localPath = await storage.localPath(snapshotId, "screenshot.png");
  try {
    await page.screenshot({ path: localPath, fullPage: true });
  } catch (err) {
    console.warn("[screenshot] extraction failed:", err);
    return;
  }

  const ref = await storage.finalize(snapshotId, "screenshot.png");

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'screenshot', ?)",
  ).run(snapshotId, ref);
}
