import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function pdfExtractor(
  db: Database,
  snapshotId: number,
  url: string,
  snapshotDir: string,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  // Playwright is an optional runtime dependency — gracefully skip if unavailable
  let chromium: import("playwright").BrowserType;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.warn("[pdf] playwright not available, skipping PDF extraction");
    return;
  }

  const pdfPath = join(snapshotDir, "page.pdf");
  let browser: import("playwright").Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { timeout: 30_000, waitUntil: "load" });
    await page.pdf({ path: pdfPath });
  } catch (err) {
    console.warn("[pdf] extraction failed:", err);
    return;
  } finally {
    await browser?.close();
  }

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'pdf', ?)",
  ).run(snapshotId, pdfPath);
}
