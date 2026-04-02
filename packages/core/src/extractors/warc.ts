import type Database from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

function buildWarcRecord(headers: Record<string, string>, block: string): string {
  const blockBytes = Buffer.byteLength(block, "utf8");
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  return `WARC/1.1\r\n${headerLines}\r\nContent-Length: ${blockBytes}\r\n\r\n${block}\r\n\r\n`;
}

export async function warcExtractor(
  db: Database,
  snapshotId: number,
  url: string,
  responseHeaders: Headers,
  statusCode: number,
  statusText: string,
  html: string,
  snapshotDir: string,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // warcinfo record
  const warcinfoBlock = "software: @webfrost/core\r\nformat: WARC File Format 1.1\r\n";
  const warcinfoRecord = buildWarcRecord(
    {
      "WARC-Type": "warcinfo",
      "WARC-Date": now,
      "WARC-Filename": "archive.warc",
      "WARC-Record-ID": `<urn:uuid:${randomUUID()}>`,
      "Content-Type": "application/warc-fields",
    },
    warcinfoBlock,
  );

  // Build HTTP response block for the response record
  const httpHeaderLines = Array.from(responseHeaders.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  const httpBlock = `HTTP/1.1 ${statusCode} ${statusText}\r\n${httpHeaderLines}\r\n\r\n${html}`;

  const responseRecord = buildWarcRecord(
    {
      "WARC-Type": "response",
      "WARC-Target-URI": url,
      "WARC-Date": now,
      "WARC-Record-ID": `<urn:uuid:${randomUUID()}>`,
      "Content-Type": "application/http;msgtype=response",
    },
    httpBlock,
  );

  const warcPath = join(snapshotDir, "archive.warc");
  await Bun.write(warcPath, warcinfoRecord + responseRecord);

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'warc', ?)",
  ).run(snapshotId, warcPath);
}
