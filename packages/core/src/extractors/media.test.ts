import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { type YtDlpSpawner, mediaExtractor } from "./media";

type SpawnResult = { exitCode: number | null; stdout: string; stderr: string };

/** Build a spawner that returns responses in order, one per call. */
function makeSpawner(responses: Array<SpawnResult | Error>): YtDlpSpawner {
  let callIndex = 0;
  return async (_args: string[]) => {
    const response = responses[callIndex++];
    if (response === undefined) throw new Error("Unexpected extra yt-dlp call");
    if (response instanceof Error) throw response;
    return response;
  };
}

const OK: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };
const FAIL: SpawnResult = { exitCode: 1, stdout: "", stderr: "ERROR" };
const META_OK: SpawnResult = {
  exitCode: 0,
  stdout: '{"title":"Test Video","duration":120}',
  stderr: "",
};

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `media-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query(
    "INSERT INTO snapshots (url, status) VALUES ('https://youtube.com/watch?v=test', 'pending')",
  ).run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function archiveRows() {
  return db
    .query<{ extractor: string; content: string }, []>(
      "SELECT extractor, content FROM archive_results WHERE snapshot_id = 1",
    )
    .all();
}

describe("mediaExtractor", () => {
  test("skips gracefully when yt-dlp is not installed (ENOENT)", async () => {
    const enoentErr = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    const spawner = makeSpawner([enoentErr]);
    const snapshotDir = join(testDir, "snapshots", "1");

    await expect(
      mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
        _spawner: spawner,
      }),
    ).resolves.toBeUndefined();

    expect(archiveRows()).toHaveLength(0);
  });

  test("skips silently when URL is not media-extractable (detect exit 1)", async () => {
    const spawner = makeSpawner([FAIL]);
    const snapshotDir = join(testDir, "snapshots", "1");

    await expect(
      mediaExtractor(db, 1, snapshotDir, "https://example.com/page", { _spawner: spawner }),
    ).resolves.toBeUndefined();

    expect(archiveRows()).toHaveLength(0);
  });

  test("stores metadata and video path on successful video download", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const spawner = makeSpawner([
      OK, // detect
      META_OK, // metadata
      OK, // video download
    ]);

    await mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = archiveRows();
    const metaRow = rows.find((r) => r.extractor === "media-metadata");
    const mediaRow = rows.find((r) => r.extractor === "media");

    expect(metaRow).toBeDefined();
    expect(metaRow?.content).toContain("media-metadata.json");
    expect(mediaRow).toBeDefined();
    expect(mediaRow?.content).toContain("media.mp4");
  });

  test("falls back to audio-only (mp3) when video download fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const spawner = makeSpawner([
      OK, // detect
      META_OK, // metadata
      FAIL, // video fails
      OK, // audio fallback succeeds
    ]);

    await mediaExtractor(db, 1, snapshotDir, "https://soundcloud.com/track", {
      _spawner: spawner,
    });

    const rows = archiveRows();
    const mediaRow = rows.find((r) => r.extractor === "media");
    expect(mediaRow).toBeDefined();
    expect(mediaRow?.content).toContain("media.mp3");
  });

  test("stores only metadata row when both video and audio downloads fail", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const spawner = makeSpawner([
      OK, // detect
      META_OK, // metadata
      FAIL, // video fails
      FAIL, // audio fails
    ]);

    await mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = archiveRows();
    expect(rows.filter((r) => r.extractor === "media")).toHaveLength(0);
    expect(rows.filter((r) => r.extractor === "media-metadata")).toHaveLength(1);
  });

  test("passes maxFileSize option to download commands", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const calls: string[][] = [];

    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return OK;
    };

    await mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
      maxFileSize: "100m",
      _spawner: spawner,
    });

    // Video download args should have --max-filesize 100m
    const downloadCall = calls.find((a) => a.includes("--max-filesize"));
    expect(downloadCall).toBeDefined();
    const idx = downloadCall?.indexOf("--max-filesize") ?? -1;
    expect(downloadCall?.[idx + 1]).toBe("100m");
  });

  test("uses 500m as default maxFileSize", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const calls: string[][] = [];

    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return OK;
    };

    await mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const downloadCall = calls.find((a) => a.includes("--max-filesize"));
    const idx = downloadCall?.indexOf("--max-filesize") ?? -1;
    expect(downloadCall?.[idx + 1]).toBe("500m");
  });

  test("writes metadata JSON file to disk", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const spawner = makeSpawner([
      OK, // detect
      { exitCode: 0, stdout: '{"title":"Hello","duration":42}', stderr: "" }, // metadata
      OK, // video
    ]);

    await mediaExtractor(db, 1, snapshotDir, "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = archiveRows();
    const metaRow = rows.find((r) => r.extractor === "media-metadata");
    expect(metaRow).toBeDefined();
    const file = Bun.file(metaRow?.content ?? "");
    expect(await file.exists()).toBe(true);
    const text = await file.text();
    expect(text).toBe('{"title":"Hello","duration":42}');
  });
});
