import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Generate a PDF from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.pdf().
 */
export async function pdfExtractor(
  db: Database,
  snapshotId: number,
  snapshotDir: string,
  page: import("playwright").Page,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  const pdfPath = join(snapshotDir, "page.pdf");
  try {
    await page.pdf({ path: pdfPath });
  } catch (err) {
    console.warn("[pdf] extraction failed:", err);
    return;
  }

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'pdf', ?)",
  ).run(snapshotId, pdfPath);
}
