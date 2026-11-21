import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db";
import { recordResult } from "../results";
import type { FetchedResponse } from "../ssrf-guard";
import type { StorageBackend } from "../storage";

/** What the WARC writer needs from a fetch: the final response and the redirects before it. */
export interface WarcSource extends FetchedResponse {
  requestedUrl: string;
  redirects: FetchedResponse[];
}

const encoder = new TextEncoder();
const CRLF = "\r\n";

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (the encoding WARC digests conventionally use). */
function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

/** `sha1:<base32>` digest as used by WARC-Block-Digest / WARC-Payload-Digest. */
export function warcDigest(bytes: Uint8Array): string {
  return `sha1:${base32(createHash("sha1").update(bytes).digest())}`;
}

function warcRecord(headers: Record<string, string>, block: Uint8Array): Uint8Array {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  lines.push(`WARC-Block-Digest: ${warcDigest(block)}`);
  lines.push(`Content-Length: ${block.byteLength}`);
  const head = `WARC/1.1${CRLF}${lines.join(CRLF)}${CRLF}${CRLF}`;
  return concat([encoder.encode(head), block, encoder.encode(CRLF + CRLF)]);
}

/**
 * The HTTP response message stored in a `response` record.
 *
 * The body is kept exactly as the server sent it, still in its Content-Encoding,
 * so `Content-Encoding` (and the payload digest) stay true. What the runtime does
 * not give back is the chunked transfer framing, so `Transfer-Encoding` is dropped
 * and `Content-Length` is set to the length of the body actually stored: a reader
 * that trusts the headers then finds exactly the bytes that follow.
 */
function httpResponseBlock(res: FetchedResponse): Uint8Array {
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText}`.trimEnd()];
  for (const [name, value] of res.headers.entries()) {
    if (name === "transfer-encoding" || name === "content-length" || name === "set-cookie") {
      continue;
    }
    lines.push(`${name}: ${value}`);
  }
  for (const cookie of res.headers.getSetCookie()) lines.push(`set-cookie: ${cookie}`);
  const hasBody = res.body.byteLength > 0 || res.headers.has("content-length");
  if (hasBody) lines.push(`content-length: ${res.body.byteLength}`);
  return concat([encoder.encode(lines.join(CRLF) + CRLF + CRLF), res.body]);
}

function warcDate(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function recordId(): string {
  return `<urn:uuid:${randomUUID()}>`;
}

/**
 * Build a WARC 1.1 file for one fetch: a `warcinfo` record, one `response` record
 * per redirect hop, the final `response` record (WARC-Target-URI = the URL that
 * answered) and a `metadata` record pointing at it that keeps the URL originally
 * asked for.
 */
export function buildWarc(source: WarcSource): Uint8Array {
  const now = warcDate();
  const warcinfoId = recordId();
  const records: Uint8Array[] = [
    warcRecord(
      {
        "WARC-Type": "warcinfo",
        "WARC-Date": now,
        "WARC-Filename": "archive.warc",
        "WARC-Record-ID": warcinfoId,
        "Content-Type": "application/warc-fields",
      },
      encoder.encode(`software: @webfrost/core${CRLF}format: WARC File Format 1.1${CRLF}`),
    ),
  ];

  const responseRecord = (res: FetchedResponse, id: string) =>
    warcRecord(
      {
        "WARC-Type": "response",
        "WARC-Record-ID": id,
        "WARC-Warcinfo-ID": warcinfoId,
        "WARC-Target-URI": res.url,
        "WARC-Date": now,
        "WARC-Payload-Digest": warcDigest(res.body),
        "Content-Type": "application/http;msgtype=response",
      },
      httpResponseBlock(res),
    );

  for (const hop of source.redirects) records.push(responseRecord(hop, recordId()));

  const finalId = recordId();
  records.push(responseRecord(source, finalId));

  const fields = [`requested-url: ${source.requestedUrl}`];
  for (const hop of source.redirects) {
    fields.push(`redirect: ${hop.status} ${hop.url} -> ${hop.headers.get("location") ?? ""}`);
  }
  records.push(
    warcRecord(
      {
        "WARC-Type": "metadata",
        "WARC-Record-ID": recordId(),
        "WARC-Warcinfo-ID": warcinfoId,
        "WARC-Target-URI": source.url,
        "WARC-Date": now,
        "WARC-Concurrent-To": finalId,
        "Content-Type": "application/warc-fields",
      },
      encoder.encode(fields.join(CRLF) + CRLF),
    ),
  );

  return concat(records);
}

export async function warcExtractor(
  db: Db,
  snapshotId: number,
  source: WarcSource,
  storage: StorageBackend,
  signal?: AbortSignal,
  lease?: string,
): Promise<void> {
  const warc = buildWarc(source);
  const ref = await storage.putBytes(snapshotId, "archive.warc", warc);
  signal?.throwIfAborted();

  await recordResult(
    db,
    snapshotId,
    { extractor: "warc", content: ref, sizeBytes: warc.byteLength },
    lease,
  );
}
