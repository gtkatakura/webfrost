import type { Db } from "../db";
import type { Logger } from "../pipeline";
import { recordResult } from "../results";
import { envInt } from "../ssrf-guard";
import type { StorageBackend } from "../storage";
import { runProcess } from "../subprocess";
import { withSpan } from "../telemetry";

/** Hard cap for a single yt-dlp invocation; the process is killed when it is exceeded. */
const DEFAULT_MEDIA_TIMEOUT_MS = 10 * 60_000;

type SpawnResult = { exitCode: number | null; stdout: string; stderr: string };

// Exported for testing — allows injecting a fake spawner via options._spawner
export type YtDlpSpawner = (args: string[], signal?: AbortSignal) => Promise<SpawnResult>;

/**
 * Options on every yt-dlp call. The URL is untrusted input, so:
 * - `--ignore-config`: no config file on the host (or in $HOME) can add options
 *   such as `--exec` or change where files go;
 * - `--no-playlist`, `--playlist-items 1`: a video URL that is also part of a
 *   playlist, or a playlist / channel URL, fetches one item, not hundreds;
 * - `--use-extractors default,-generic`: only sites yt-dlp knows. The generic
 *   extractor would download and scan any web page for embedded media, which is
 *   a second full fetch of every archived page outside the SSRF guard.
 * The URL always comes after `--` so it can never be read as an option.
 */
export const YT_DLP_BASE_ARGS = [
  "--ignore-config",
  "--no-playlist",
  "--playlist-items",
  "1",
  "--use-extractors",
  "default,-generic",
] as const;

function defaultSpawner(args: string[], signal?: AbortSignal): Promise<SpawnResult> {
  const step = args.includes("--dump-json") ? "metadata" : "download";
  return withSpan(
    "media.yt-dlp",
    { attributes: { "process.executable.name": "yt-dlp", "webfrost.media.step": step } },
    async (span) => {
      const result = await runProcess(["yt-dlp", ...args], {
        timeoutMs: envInt("WEBFROST_MEDIA_TIMEOUT_MS", DEFAULT_MEDIA_TIMEOUT_MS),
        // yt-dlp starts ffmpeg to merge streams; kill them together.
        processGroup: true,
        ...(signal ? { signal } : {}),
      });
      span.setAttributes({ "process.exit.code": result.exitCode ?? -1 });
      return result;
    },
  );
}

function ytDlpArgs(options: string[], url: string): string[] {
  return [...YT_DLP_BASE_ARGS, ...options, "--", url];
}

/**
 * Download and archive video/audio from media-hosting URLs (YouTube, Vimeo, etc.)
 * using yt-dlp.
 *
 * Gracefully skips if yt-dlp is not installed or the URL is not extractable.
 * Stores files in {snapshotDir}/media/ and records paths in archive_results:
 *   - extractor = "media"          → media.mp4 (or media.mp3 for audio-only fallback)
 *   - extractor = "media-metadata" → media-metadata.json
 */
export async function mediaExtractor(
  db: Db,
  snapshotId: number,
  storage: StorageBackend,
  url: string,
  options?: {
    maxFileSize?: string;
    _spawner?: YtDlpSpawner;
    logger?: Logger;
    /** Aborted when the pipeline has given up on this extractor; nothing is recorded after that. */
    signal?: AbortSignal;
    /** Job lease the results are written under (see results.ts). */
    lease?: string;
  },
): Promise<void> {
  const maxFileSize = options?.maxFileSize ?? "500m";
  const spawner = options?._spawner ?? defaultSpawner;
  const logger = options?.logger;
  const signal = options?.signal;
  const lease = options?.lease;

  // Step 1: Extract the metadata. This doubles as the check that yt-dlp is
  // installed and supports the URL (a non-zero exit means it is not a media page).
  let metaResult: SpawnResult;
  try {
    metaResult = await spawner(ytDlpArgs(["--dump-json", "--quiet"], url), signal);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.info("[media] yt-dlp not found — skipping media extraction");
      return;
    }
    throw err;
  }

  if (metaResult.exitCode !== 0) {
    // URL not supported by yt-dlp — not an error, just not a media URL
    return;
  }
  const metadataJson = metaResult.stdout.trim() || "{}";

  signal?.throwIfAborted();
  const metadataRef = await storage.putText(snapshotId, "media/media-metadata.json", metadataJson);
  await recordResult(
    db,
    snapshotId,
    {
      extractor: "media-metadata",
      content: metadataRef,
      sizeBytes: Buffer.byteLength(metadataJson, "utf8"),
    },
    lease,
  );

  // Step 2: Attempt video download (bestvideo+bestaudio merged to mp4)
  const videoLocalPath = await storage.localPath(snapshotId, "media/media.mp4");
  let videoResult: SpawnResult;
  try {
    videoResult = await spawner(
      ytDlpArgs(
        [
          "-f",
          "bestvideo+bestaudio/best",
          "--merge-output-format",
          "mp4",
          "--max-filesize",
          maxFileSize,
          "-o",
          videoLocalPath,
        ],
        url,
      ),
      signal,
    );
  } catch (err: unknown) {
    if (!signal?.aborted && (err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.info("[media] yt-dlp not found — skipping media download");
      return;
    }
    throw err;
  }

  signal?.throwIfAborted();
  if (videoResult.exitCode === 0) {
    const sizeBytes = Bun.file(videoLocalPath).size;
    const videoRef = await storage.finalize(snapshotId, "media/media.mp4");
    await recordResult(db, snapshotId, { extractor: "media", content: videoRef, sizeBytes }, lease);
    return;
  }

  // Step 3: Audio-only fallback (for audio-only sources like SoundCloud, podcasts)
  const audioLocalPath = await storage.localPath(snapshotId, "media/media.mp3");
  let audioResult: SpawnResult;
  try {
    audioResult = await spawner(
      ytDlpArgs(
        [
          "-f",
          "bestaudio",
          "-x",
          "--audio-format",
          "mp3",
          "--max-filesize",
          maxFileSize,
          "-o",
          audioLocalPath,
        ],
        url,
      ),
      signal,
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    return;
  }

  signal?.throwIfAborted();
  if (audioResult.exitCode === 0) {
    const sizeBytes = Bun.file(audioLocalPath).size;
    const audioRef = await storage.finalize(snapshotId, "media/media.mp3");
    await recordResult(db, snapshotId, { extractor: "media", content: audioRef, sizeBytes }, lease);
  }
}
