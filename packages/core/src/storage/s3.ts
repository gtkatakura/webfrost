import { mkdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { S3Client } from "bun";
import type { PresignedResponseHeaders, StorageBackend } from "./interface";

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
 * Uses Bun's native S3Client — zero external dependencies.
 *
 * DB refs have the form `s3:{key}` where `key` is the full S3 object key.
 *
 * For Playwright/yt-dlp extractors that must write to a local file first,
 * `localPath()` returns a path under the system's temp dir. After the external
 * process writes the file, `finalize()` uploads it to S3 and deletes the temp
 * file.
 */
export class S3Backend implements StorageBackend {
  private readonly client: S3Client;
  private readonly config: Required<S3Config>;
  private readonly tempBase: string;

  constructor(config: S3Config) {
    this.config = {
      region: "us-east-1",
      pathPrefix: "snapshots",
      ...config,
    };
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      accessKeyId: this.config.accessKey,
      secretAccessKey: this.config.secretKey,
      region: this.config.region,
    });
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

  /** Local temp path for external-process writes (Playwright, yt-dlp). */
  private tempPath(snapshotId: number, filename: string): string {
    return join(this.tempBase, String(snapshotId), filename);
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
    await this.client.write(key, bytes);

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
    await this.client.write(key, content);
    return this.toRef(key);
  }

  async putBytes(snapshotId: number, filename: string, content: Uint8Array): Promise<string> {
    const key = this.key(snapshotId, filename);
    await this.client.write(key, content);
    return this.toRef(key);
  }

  async getBytes(ref: string): Promise<Uint8Array> {
    const key = this.fromRef(ref);
    return this.client.file(key).bytes();
  }

  async fileExists(ref: string): Promise<boolean> {
    const key = this.fromRef(ref);
    return this.client.exists(key);
  }

  async fileSize(ref: string): Promise<number> {
    try {
      const key = this.fromRef(ref);
      return await this.client.size(key);
    } catch {
      return 0;
    }
  }

  validateRef(ref: string): boolean {
    if (!ref.startsWith(S3_REF_PREFIX)) return false;
    const key = ref.slice(S3_REF_PREFIX.length);
    return key.startsWith(`${this.config.pathPrefix}/`);
  }

  /**
   * Return a presigned download URL for the given DB ref.
   * Expires in 1 hour by default. The server returns a 302 redirect to this
   * URL, enabling zero-copy streaming directly from S3 to the client.
   * `response` becomes the signed response-content-type/-disposition overrides.
   */
  presignedDownloadUrl(
    ref: string,
    expiresIn = 3600,
    response: PresignedResponseHeaders = {},
  ): string {
    const key = this.fromRef(ref);
    return this.client.presign(key, {
      expiresIn,
      ...(response.contentType ? { type: response.contentType } : {}),
      ...(response.contentDisposition ? { contentDisposition: response.contentDisposition } : {}),
    });
  }

  async deleteAll(snapshotId: number): Promise<void> {
    const prefix = `${this.config.pathPrefix}/${snapshotId}/`;
    try {
      let startAfter: string | undefined;
      for (;;) {
        const result = await this.client.list({
          prefix,
          ...(startAfter ? { startAfter } : {}),
        });
        const keys = (result.contents ?? []).map((c) => c.key).filter(Boolean) as string[];
        await Promise.all(
          keys.map(async (k) => {
            try {
              await this.client.delete(k);
            } catch {
              // best-effort
            }
          }),
        );
        if (!result.isTruncated || keys.length === 0) break;
        startAfter = keys[keys.length - 1];
      }
    } catch {
      // best-effort — don't fail snapshot deletion if S3 is unreachable
    }

    // Also clean up any leftover temp files
    try {
      await rm(join(this.tempBase, String(snapshotId)), { recursive: true, force: true });
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
