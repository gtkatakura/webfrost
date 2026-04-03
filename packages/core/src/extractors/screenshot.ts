import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Capture a full-page PNG screenshot from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.screenshot().
 */
export async function screenshotExtractor(
  db: Database,
  snapshotId: number,
  snapshotDir: string,
  page: import("playwright").Page,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  const screenshotPath = join(snapshotDir, "screenshot.png");
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (err) {
    console.warn("[screenshot] extraction failed:", err);
    return;
  }

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'screenshot', ?)",
  ).run(snapshotId, screenshotPath);
}
