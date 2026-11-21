import type Database from "bun:sqlite";
import type { Logger } from "../pipeline";
import { envInt } from "../ssrf-guard";
import type { StorageBackend } from "../storage";
import { runProcess } from "../subprocess";

/** Hard cap for a single yt-dlp invocation; the process is killed when it is exceeded. */
const DEFAULT_MEDIA_TIMEOUT_MS = 10 * 60_000;

type SpawnResult = { exitCode: number | null; stdout: string; stderr: string };

// Exported for testing — allows injecting a fake spawner via options._spawner
export type YtDlpSpawner = (args: string[]) => Promise<SpawnResult>;

function defaultSpawner(args: string[]): Promise<SpawnResult> {
  return runProcess(["yt-dlp", ...args], {
    timeoutMs: envInt("WEBFROST_MEDIA_TIMEOUT_MS", DEFAULT_MEDIA_TIMEOUT_MS),
  });
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
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  url: string,
  options?: {
    maxFileSize?: string;
    _spawner?: YtDlpSpawner;
    logger?: Logger;
    /** Aborted when the pipeline has given up on this extractor; nothing is recorded after that. */
    signal?: AbortSignal;
  },
): Promise<void> {
  const maxFileSize = options?.maxFileSize ?? "500m";
  const spawner = options?._spawner ?? defaultSpawner;
  const logger = options?.logger;
  const signal = options?.signal;

  // Step 1: Detect whether yt-dlp is installed and the URL is extractable
  let detectResult: SpawnResult;
  try {
    detectResult = await spawner(["--simulate", "--quiet", url]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.info("[media] yt-dlp not found — skipping media extraction");
      return;
    }
    throw err;
  }

  if (detectResult.exitCode !== 0) {
    // URL not supported by yt-dlp — not an error, just not a media URL
    return;
  }

  // Step 2: Extract metadata JSON
  let metadataJson: string;
  try {
    const metaResult = await spawner(["--dump-json", url]);
    metadataJson = metaResult.stdout || "{}";
  } catch {
    metadataJson = "{}";
  }

  signal?.throwIfAborted();
  const metadataRef = await storage.putText(snapshotId, "media/media-metadata.json", metadataJson);
  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media-metadata', ?)",
  ).run(snapshotId, metadataRef);

  // Step 3: Attempt video download (bestvideo+bestaudio merged to mp4)
  const videoLocalPath = await storage.localPath(snapshotId, "media/media.mp4");
  let videoResult: SpawnResult;
  try {
    videoResult = await spawner([
      "-f",
      "bestvideo+bestaudio/best",
      "--merge-output-format",
      "mp4",
      "--max-filesize",
      maxFileSize,
      "-o",
      videoLocalPath,
      url,
    ]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.info("[media] yt-dlp not found — skipping media download");
      return;
    }
    throw err;
  }

  signal?.throwIfAborted();
  if (videoResult.exitCode === 0) {
    const videoRef = await storage.finalize(snapshotId, "media/media.mp4");
    db.query<null, [number, string]>(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media', ?)",
    ).run(snapshotId, videoRef);
    return;
  }

  // Step 4: Audio-only fallback (for audio-only sources like SoundCloud, podcasts)
  const audioLocalPath = await storage.localPath(snapshotId, "media/media.mp3");
  let audioResult: SpawnResult;
  try {
    audioResult = await spawner([
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "mp3",
      "--max-filesize",
      maxFileSize,
      "-o",
      audioLocalPath,
      url,
    ]);
  } catch {
    return;
  }

  signal?.throwIfAborted();
  if (audioResult.exitCode === 0) {
    const audioRef = await storage.finalize(snapshotId, "media/media.mp3");
    db.query<null, [number, string]>(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media', ?)",
    ).run(snapshotId, audioRef);
  }
}
