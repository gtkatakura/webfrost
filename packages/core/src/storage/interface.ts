/**
 * Storage backend abstraction for WebFrost archive artifacts.
 *
 * All artifact files (screenshots, PDFs, WARCs, etc.) are written through this
 * interface so the storage layer can be swapped between local filesystem and an
 * S3-compatible object store (MinIO, Cloudflare R2, Backblaze B2, AWS S3).
 *
 * DB content references
 * ─────────────────────
 * Each backend stores a string "ref" in `archive_results.content` that it can
 * later resolve back to the actual bytes.
 *
 * - FilesystemBackend: absolute local path, e.g. `/data/snapshots/1/archive.warc`
 * - S3Backend:         S3 key prefixed with `s3:`, e.g. `s3:snapshots/1/archive.warc`
 */
export interface StorageBackend {
  /**
   * Return a local file path suitable for writing by an external process
   * (Playwright, yt-dlp, etc.).
   *
   * For FilesystemBackend: creates parent dirs and returns the final path.
   * For S3Backend:         creates a temp dir and returns a path inside it.
   *
   * After writing, call `finalize()` to make the file permanently available.
   */
  localPath(snapshotId: number, filename: string): Promise<string>;

  /**
   * Commit a file previously prepared by `localPath()`.
   *
   * For FilesystemBackend: no-op — returns the same path as `localPath()`.
   * For S3Backend:         uploads the temp file to S3, removes the temp file,
   *                        and returns the `s3:` ref.
   */
  finalize(snapshotId: number, filename: string): Promise<string>;

  /**
   * Write text (or binary) content directly and return the DB ref.
   * No need to call `finalize()` after this.
   */
  putText(snapshotId: number, filename: string, content: string): Promise<string>;

  /**
   * Write binary content directly and return the DB ref.
   * No need to call `finalize()` after this.
   */
  putBytes(snapshotId: number, filename: string, content: Uint8Array): Promise<string>;

  /** Read file bytes by DB ref. */
  getBytes(ref: string): Promise<Uint8Array>;

  /** Return true if the DB ref resolves to an existing file. */
  fileExists(ref: string): Promise<boolean>;

  /** Return the size in bytes for the given DB ref. */
  fileSize(ref: string): Promise<number>;

  /** Delete all stored files for a snapshot (best-effort; non-fatal on error). */
  deleteAll(snapshotId: number): Promise<void>;

  /**
   * Return true if the given ref was produced by this backend instance and
   * is safe to serve. Used by the server to prevent path traversal attacks.
   */
  validateRef(ref: string): boolean;

  /**
   * Return a presigned URL for direct client download, or null if the backend
   * does not support presigned URLs (e.g. FilesystemBackend).
   *
   * When non-null, the server should return a 302 redirect to this URL instead
   * of proxying bytes — enabling zero-copy streaming from the storage backend.
   */
  presignedDownloadUrl(ref: string, expiresIn?: number): string | null;
}
