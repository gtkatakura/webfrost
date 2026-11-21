import type { Db } from "../db";
import { recordResult } from "../results";

export async function htmlExtractor(
  db: Db,
  snapshotId: number,
  html: string,
  lease?: string,
): Promise<void> {
  await recordResult(
    db,
    snapshotId,
    { extractor: "html", content: html, sizeBytes: Buffer.byteLength(html, "utf8") },
    lease,
  );
}
