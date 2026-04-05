import { createHash, createHmac } from "node:crypto";
import { mkdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { StorageBackend } from "./interface";

// ─────────────────────────────────────────────────────────────
// AWS Signature V4 helpers (no external dependencies)
// ─────────────────────────────────────────────────────────────

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

interface SignedHeaders {
  [key: string]: string;
}

/**
 * Sign an HTTP request with AWS Signature V4. Returns the complete set of
 * headers to send (including Authorization and x-amz-* headers).
 */
function signV4(opts: {
  method: string;
  url: URL;
  /** Extra headers to include (all will be signed). */
  headers?: Record<string, string>;
  /** Raw body bytes — used to compute the payload hash. */
  body?: Buffer | null;
  accessKey: string;
  secretKey: string;
  region: string;
  service?: string;
}): SignedHeaders {
  const service = opts.service ?? "s3";
  const now = new Date();
  const isoBase = now
    .toISOString()
    .replace(/[:\-]|\.\d{3}/g, "")
    .replace("Z", "Z")
    .slice(0, 16);
  const datetime = `${isoBase}00Z`;
  // datetime format: YYYYMMDDTHHmmssZ
  const date = datetime.slice(0, 8);

  const bodyHash = opts.body ? sha256hex(opts.body) : sha256hex("");

  // Build the canonical headers map (lowercase keys, sorted)
  const hdrs: Record<string, string> = {
    ...(opts.headers ?? {}),
    host: opts.url.host,
    "x-amz-date": datetime,
    "x-amz-content-sha256": bodyHash,
  };

  const sortedKeys = Object.keys(hdrs)
    .map((k) => k.toLowerCase())
    .sort();

  // Deduplicate (the above map already has lowercased keys after the spread)
  const canonicalHdrs = sortedKeys
    .map((k) => {
      const v = hdrs[k] ?? hdrs[Object.keys(hdrs).find((h) => h.toLowerCase() === k) ?? ""] ?? "";
      return `${k}:${v.trim()}`;
    })
    .join("\n");

  const signedHeaders = sortedKeys.join(";");

  const canonicalQueryString = [...opts.url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [
    opts.method.toUpperCase(),
    opts.url.pathname,
    canonicalQueryString,
    `${canonicalHdrs}\n`,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${date}/${opts.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(opts.secretKey, date, opts.region, service);
  const signature = hmacSha256(signingKey, stringToSign).toString("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  // Return headers that the caller should send
  const result: SignedHeaders = {
    host: opts.url.host,
    "x-amz-date": datetime,
    "x-amz-content-sha256": bodyHash,
    authorization,
  };
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      if (k.toLowerCase() !== "host") result[k.toLowerCase()] = v;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// S3 config
// ─────────────────────────────────────────────────────────────

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  /** Key prefix for all objects. Defaults to "snapshots". */
  pathPrefix?: string;
}

// ─────────────────────────────────────────────────────────────
// S3Backend
// ─────────────────────────────────────────────────────────────

const S3_REF_PREFIX = "s3:";

/**
 * Storage backend that writes archive artifacts to an S3-compatible object
 * store (MinIO, AWS S3, Cloudflare R2, Backblaze B2).
 *
 * DB refs have the form `s3:{key}` where `key` is the full S3 object key.
 *
 * For Playwright/yt-dlp extractors that must write to a local file first,
 * `localPath()` returns a path under the system's temp dir. After the external
 * process writes the file, `finalize()` uploads it to S3 and deletes the temp
 * file.
 */
export class S3Backend implements StorageBackend {
  private readonly config: Required<S3Config>;
  private readonly tempBase: string;

  constructor(config: S3Config) {
    this.config = {
      region: "us-east-1",
      pathPrefix: "snapshots",
      ...config,
    };
    this.tempBase = join(tmpdir(), "webfrost-s3-tmp");
  }

  /** Build the S3 object key for a snapshot file. */
  private key(snapshotId: number, filename: string): string {
    return `${this.config.pathPrefix}/${snapshotId}/${filename}`;
  }

  /** Build the DB ref from an S3 key. */
  private toRef(key: string): string {
    return `${S3_REF_PREFIX}${key}`;
  }

  /** Extract the S3 key from a DB ref. */
  private fromRef(ref: string): string {
    if (!ref.startsWith(S3_REF_PREFIX)) throw new Error(`Invalid S3 ref: ${ref}`);
    return ref.slice(S3_REF_PREFIX.length);
  }

  /** Local temp path (no dirs created yet). */
  private tempPath(snapshotId: number, filename: string): string {
    return join(this.tempBase, String(snapshotId), filename);
  }

  /** Build a URL for a given S3 key. Uses path-style addressing. */
  private objectUrl(key: string): URL {
    const base = this.config.endpoint.replace(/\/$/, "");
    return new URL(`${base}/${this.config.bucket}/${key}`);
  }

  /** Execute a signed S3 request. */
  private async s3Fetch(
    method: string,
    key: string,
    body: Buffer | null,
    extraHeaders?: Record<string, string>,
    queryParams?: Record<string, string>,
  ): Promise<Response> {
    const url = this.objectUrl(key);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v);
      }
    }

    const signed = signV4({
      method,
      url,
      ...(extraHeaders ? { headers: extraHeaders } : {}),
      body,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region,
    });

    const headers: Record<string, string> = { ...signed };
    if (body !== null && method !== "DELETE") {
      headers["content-length"] = String(body.length);
    }

    return fetch(url.toString(), {
      method,
      headers,
      body: body as BodyInit | null,
    });
  }

  /** Build a URL for bucket-level operations (e.g. ListObjects). */
  private bucketUrl(queryParams: Record<string, string>): URL {
    const base = this.config.endpoint.replace(/\/$/, "");
    const url = new URL(`${base}/${this.config.bucket}/`);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  /** List all S3 keys under a given prefix. */
  private async listKeys(prefix: string): Promise<string[]> {
    const url = this.bucketUrl({ "list-type": "2", prefix });

    const signed = signV4({
      method: "GET",
      url,
      body: null,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region,
    });

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: signed,
    });

    if (!resp.ok) return [];

    const xml = await resp.text();
    // Parse keys from ListObjectsV2 XML response
    const keys: string[] = [];
    const keyRe = /<Key>([^<]+)<\/Key>/g;
    let m = keyRe.exec(xml);
    while (m !== null) {
      if (m[1]) keys.push(m[1]);
      m = keyRe.exec(xml);
    }
    return keys;
  }

  // ── StorageBackend implementation ──────────────────────────

  async localPath(snapshotId: number, filename: string): Promise<string> {
    const p = this.tempPath(snapshotId, filename);
    await mkdir(dirname(p), { recursive: true });
    return p;
  }

  async finalize(snapshotId: number, filename: string): Promise<string> {
    const p = this.tempPath(snapshotId, filename);
    const key = this.key(snapshotId, filename);

    const bytes = await Bun.file(p).bytes();
    const buf = Buffer.from(bytes);
    const resp = await this.s3Fetch("PUT", key, buf);
    if (!resp.ok) {
      throw new Error(`S3 upload failed: ${resp.status} ${await resp.text()}`);
    }

    // Remove temp file (best-effort)
    try {
      await unlink(p);
    } catch {
      // ignore
    }

    return this.toRef(key);
  }

  async putText(snapshotId: number, filename: string, content: string): Promise<string> {
    const key = this.key(snapshotId, filename);
    const buf = Buffer.from(content, "utf8");
    const resp = await this.s3Fetch("PUT", key, buf, {
      "content-type": "text/plain; charset=utf-8",
    });
    if (!resp.ok) {
      throw new Error(`S3 upload failed: ${resp.status} ${await resp.text()}`);
    }
    return this.toRef(key);
  }

  async putBytes(snapshotId: number, filename: string, content: Uint8Array): Promise<string> {
    const key = this.key(snapshotId, filename);
    const buf = Buffer.from(content);
    const resp = await this.s3Fetch("PUT", key, buf);
    if (!resp.ok) {
      throw new Error(`S3 upload failed: ${resp.status} ${await resp.text()}`);
    }
    return this.toRef(key);
  }

  async getBytes(ref: string): Promise<Uint8Array> {
    const key = this.fromRef(ref);
    const resp = await this.s3Fetch("GET", key, null);
    if (!resp.ok) {
      throw new Error(`S3 download failed: ${resp.status}`);
    }
    return new Uint8Array(await resp.arrayBuffer());
  }

  async fileExists(ref: string): Promise<boolean> {
    const key = this.fromRef(ref);
    const resp = await this.s3Fetch("HEAD", key, null);
    return resp.ok;
  }

  async fileSize(ref: string): Promise<number> {
    const key = this.fromRef(ref);
    const resp = await this.s3Fetch("HEAD", key, null);
    if (!resp.ok) return 0;
    const len = resp.headers.get("content-length");
    return len ? Number(len) : 0;
  }

  validateRef(ref: string): boolean {
    if (!ref.startsWith(S3_REF_PREFIX)) return false;
    const key = ref.slice(S3_REF_PREFIX.length);
    return key.startsWith(`${this.config.pathPrefix}/`);
  }

  async deleteAll(snapshotId: number): Promise<void> {
    const prefix = `${this.config.pathPrefix}/${snapshotId}/`;
    let keys: string[];
    try {
      keys = await this.listKeys(prefix);
    } catch {
      return;
    }
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.s3Fetch("DELETE", key, null);
        } catch {
          // best-effort
        }
      }),
    );

    // Also clean up any leftover temp files
    const tmpDir = join(this.tempBase, String(snapshotId));
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/** Validate that a DB ref belongs to the configured bucket prefix. */
export function validateS3Ref(ref: string, expectedPrefix: string): boolean {
  if (!ref.startsWith(S3_REF_PREFIX)) return false;
  const key = ref.slice(S3_REF_PREFIX.length);
  return key.startsWith(`${expectedPrefix}/`);
}
