import type Database from "bun:sqlite";

export interface MediaExtractorOptions {
  /** Extract audio only (no video). Default: false. */
  audioOnly?: boolean;
  /** Max file size passed to yt-dlp --max-filesize (e.g. "500M"). */
  maxFileSize?: string;
}

/**
 * Extract and archive video/audio from a URL using yt-dlp.
 *
 * Writes two rows to archive_results on success:
 *   - extractor="media"          — path to the downloaded media file
 *   - extractor="media-metadata" — JSON string from yt-dlp --dump-json
 *
 * Skips silently (does not throw) if:
 *   - yt-dlp is not installed (ENOENT)
 *   - The URL is not supported by yt-dlp (--simulate exits non-zero)
 *   - The download fails for any reason
 *
 * TODO: implement (WEB-125)
 */
export async function mediaExtractor(
  _db: Database,
  _snapshotId: number,
  _url: string,
  _snapshotDir: string,
  _options?: MediaExtractorOptions,
): Promise<void> {
  throw new Error("Not implemented — see WEB-125");
}
