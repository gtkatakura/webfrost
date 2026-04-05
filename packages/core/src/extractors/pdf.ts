import type Database from "bun:sqlite";
import type { StorageBackend } from "../storage";

/**
 * Generate a PDF from an already-navigated Playwright page.
 * The page must already have called page.goto() before this extractor runs;
 * this extractor does NOT navigate — it just calls page.pdf().
 */
export async function pdfExtractor(
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
): Promise<void> {
  const localPath = await storage.localPath(snapshotId, "page.pdf");
  try {
    await page.pdf({ path: localPath });
  } catch (err) {
    console.warn("[pdf] extraction failed:", err);
    return;
  }

  const ref = await storage.finalize(snapshotId, "page.pdf");

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'pdf', ?)",
  ).run(snapshotId, ref);
}
