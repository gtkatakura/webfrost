import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../pipeline";

type SpawnResult = { exitCode: number | null; stdout: string; stderr: string };

// Exported for testing — allows injecting a fake spawner via options._spawner
export type YtDlpSpawner = (args: string[]) => Promise<SpawnResult>;

async function defaultSpawner(args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(["yt-dlp", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
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
  snapshotDir: string,
  url: string,
  options?: { maxFileSize?: string; _spawner?: YtDlpSpawner; logger?: Logger },
): Promise<void> {
  const maxFileSize = options?.maxFileSize ?? "500m";
  const spawner = options?._spawner ?? defaultSpawner;
  const logger = options?.logger;
  const mediaDir = join(snapshotDir, "media");
  await mkdir(mediaDir, { recursive: true });

  // Step 1: Detect whether yt-dlp is installed and the URL is extractable
  let detectResult: SpawnResult;
  try {
    detectResult = await spawner(["--simulate", "--quiet", url]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.warn("[media] yt-dlp not found — skipping media extraction");
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

  const metadataPath = join(mediaDir, "media-metadata.json");
  await Bun.write(metadataPath, metadataJson);
  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media-metadata', ?)",
  ).run(snapshotId, metadataPath);

  // Step 3: Attempt video download (bestvideo+bestaudio merged to mp4)
  const videoPath = join(mediaDir, "media.mp4");
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
      videoPath,
      url,
    ]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.warn("[media] yt-dlp not found — skipping media download");
      return;
    }
    throw err;
  }

  if (videoResult.exitCode === 0) {
    db.query<null, [number, string]>(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media', ?)",
    ).run(snapshotId, videoPath);
    return;
  }

  // Step 4: Audio-only fallback (for audio-only sources like SoundCloud, podcasts)
  const audioPath = join(mediaDir, "media.mp3");
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
      audioPath,
      url,
    ]);
  } catch {
    return;
  }

  if (audioResult.exitCode === 0) {
    db.query<null, [number, string]>(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'media', ?)",
    ).run(snapshotId, audioPath);
  }
}
