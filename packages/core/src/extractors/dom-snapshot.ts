import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Capture the post-JS-execution DOM from an already-navigated Playwright page.
 * Unlike the raw HTML extractor (which captures the server response), this
 * captures the live DOM after client-side JavaScript has run.
 * The page must already have called page.goto() before this extractor runs.
 */
export async function domSnapshotExtractor(
  db: Database,
  snapshotId: number,
  snapshotDir: string,
  page: import("playwright").Page,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  let dom: string;
  try {
    dom = await page.content();
  } catch (err) {
    console.warn("[dom-snapshot] extraction failed:", err);
    return;
  }

  const domPath = join(snapshotDir, "dom.html");
  await Bun.write(domPath, dom);

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'dom-snapshot', ?)",
  ).run(snapshotId, domPath);
}
