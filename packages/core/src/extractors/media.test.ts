import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { YT_DLP_BASE_ARGS, type YtDlpSpawner, mediaExtractor, ytDlpError } from "./media";

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
const FAIL: SpawnResult = {
  exitCode: 1,
  stdout: "",
  stderr: "ERROR: Unsupported URL: https://example.com/page\n",
};
const META_OK: SpawnResult = {
  exitCode: 0,
  stdout: '{"title":"Test Video","duration":120}',
  stderr: "",
};

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `media-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(
    sql`INSERT INTO snapshots (url, status) VALUES ('https://youtube.com/watch?v=test', 'pending')`,
  );
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

function archiveRows() {
  return db.all<{ extractor: string; content: string }>(
    sql`SELECT extractor, content FROM archive_results WHERE snapshot_id = 1`,
  );
}

describe("mediaExtractor", () => {
  test("skips gracefully when yt-dlp is not installed (ENOENT)", async () => {
    const enoentErr = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    const spawner = makeSpawner([enoentErr]);

    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
        _spawner: spawner,
      }),
    ).resolves.toBeUndefined();

    expect(await archiveRows()).toHaveLength(0);
  });

  test("skips silently when URL is not media-extractable (metadata exit 1)", async () => {
    const spawner = makeSpawner([FAIL]);

    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://example.com/page", { _spawner: spawner }),
    ).resolves.toBeUndefined();

    expect(await archiveRows()).toHaveLength(0);
  });

  test("fails with yt-dlp's reason when a media site refuses the video", async () => {
    const spawner = makeSpawner([
      {
        exitCode: 1,
        stdout: "",
        stderr:
          "WARNING: [youtube] No title found in player responses\nERROR: [youtube] aqz-KE-bpKQ: Sign in to confirm you’re not a bot. Use --cookies\n",
      },
    ]);

    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://www.youtube.com/watch?v=aqz-KE-bpKQ", {
        _spawner: spawner,
      }),
    ).rejects.toThrow("yt-dlp: aqz-KE-bpKQ: Sign in to confirm you’re not a bot");
    expect(await archiveRows()).toHaveLength(0);
  });

  test("ytDlpError keeps the first ERROR line, without prefix, at a readable length", () => {
    expect(ytDlpError("WARNING: x\nERROR: [vimeo] 123: Private video\nERROR: later")).toBe(
      "123: Private video",
    );
    expect(ytDlpError("WARNING: only a warning")).toBeNull();
    expect(ytDlpError(`ERROR: ${"x".repeat(500)}`)?.length).toBe(200);
  });

  test("stores metadata and video path on successful video download", async () => {
    const spawner = makeSpawner([
      META_OK, // metadata
      OK, // video download
    ]);

    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = await archiveRows();
    const metaRow = rows.find((r) => r.extractor === "media-metadata");
    const mediaRow = rows.find((r) => r.extractor === "media");

    expect(metaRow).toBeDefined();
    expect(metaRow?.content).toContain("media-metadata.json");
    expect(mediaRow).toBeDefined();
    expect(mediaRow?.content).toContain("media.mp4");
  });

  test("falls back to audio-only (mp3) when video download fails", async () => {
    const spawner = makeSpawner([
      META_OK, // metadata
      FAIL, // video fails
      OK, // audio fallback succeeds
    ]);

    await mediaExtractor(db, 1, makeStorage(), "https://soundcloud.com/track", {
      _spawner: spawner,
    });

    const rows = await archiveRows();
    const mediaRow = rows.find((r) => r.extractor === "media");
    expect(mediaRow).toBeDefined();
    expect(mediaRow?.content).toContain("media.mp3");
  });

  test("stores only metadata row when both video and audio downloads fail", async () => {
    const spawner = makeSpawner([
      META_OK, // metadata
      FAIL, // video fails
      FAIL, // audio fails
    ]);

    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = await archiveRows();
    expect(rows.filter((r) => r.extractor === "media")).toHaveLength(0);
    expect(rows.filter((r) => r.extractor === "media-metadata")).toHaveLength(1);
  });

  test("passes maxFileSize option to download commands", async () => {
    const calls: string[][] = [];

    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return OK;
    };

    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
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
    const calls: string[][] = [];

    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return OK;
    };

    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const downloadCall = calls.find((a) => a.includes("--max-filesize"));
    const idx = downloadCall?.indexOf("--max-filesize") ?? -1;
    expect(downloadCall?.[idx + 1]).toBe("500m");
  });

  test("writes metadata JSON file to storage", async () => {
    const spawner = makeSpawner([
      { exitCode: 0, stdout: '{"title":"Hello","duration":42}', stderr: "" }, // metadata
      OK, // video
    ]);

    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });

    const rows = await archiveRows();
    const metaRow = rows.find((r) => r.extractor === "media-metadata");
    expect(metaRow).toBeDefined();
    const file = Bun.file(metaRow?.content ?? "");
    expect(await file.exists()).toBe(true);
    const text = await file.text();
    expect(text).toBe('{"title":"Hello","duration":42}');
  });

  test("probes and reads metadata in one call: --dump-json is the first and only probe", async () => {
    const calls: string[][] = [];
    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return FAIL;
    };
    await mediaExtractor(db, 1, makeStorage(), "https://example.com/page", { _spawner: spawner });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--dump-json");
    expect(calls[0]).not.toContain("--simulate");
  });

  test("every call ignores config, refuses playlists and the generic extractor, and ends with -- URL", async () => {
    const calls: string[][] = [];
    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return calls.length === 2 ? FAIL : OK; // video fails → audio fallback runs too
    };
    const url = "-oops-looks-like-an-option";
    await mediaExtractor(db, 1, makeStorage(), url, { _spawner: spawner });
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args.slice(0, YT_DLP_BASE_ARGS.length)).toEqual([...YT_DLP_BASE_ARGS]);
      expect(args).toContain("--ignore-config");
      expect(args).toContain("--no-playlist");
      expect(args[args.indexOf("--use-extractors") + 1]).toBe("default,-generic");
      expect(args.slice(-2)).toEqual(["--", url]);
    }
  });

  test("passes its signal to yt-dlp and records nothing once aborted", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const spawner: YtDlpSpawner = async (_args, signal) => {
      seen.push(signal);
      // The pipeline gives up while the metadata call runs.
      controller.abort(new Error("extractor media timed out"));
      return META_OK;
    };
    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
        _spawner: spawner,
        signal: controller.signal,
      }),
    ).rejects.toThrow("timed out");
    expect(seen).toEqual([controller.signal]);
    expect(await archiveRows()).toHaveLength(0);
  });
});

describe("mediaExtractor: format selection", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.WEBFROST_MEDIA_MAX_HEIGHT;
  });
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_MEDIA_MAX_HEIGHT");
    else process.env.WEBFROST_MEDIA_MAX_HEIGHT = saved;
  });

  async function sortArg(): Promise<string | undefined> {
    const calls: string[][] = [];
    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return calls.length === 1 ? META_OK : OK;
    };
    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });
    const video = calls[1] ?? [];
    return video[video.indexOf("-S") + 1];
  }

  test("prefers up to 1080p, H.264 and AAC by default", async () => {
    Reflect.deleteProperty(process.env, "WEBFROST_MEDIA_MAX_HEIGHT");
    expect(await sortArg()).toBe("res:1080,vcodec:h264,acodec:aac");
  });

  test("honours WEBFROST_MEDIA_MAX_HEIGHT", async () => {
    process.env.WEBFROST_MEDIA_MAX_HEIGHT = "720";
    expect(await sortArg()).toBe("res:720,vcodec:h264,acodec:aac");
  });

  test("WEBFROST_MEDIA_MAX_HEIGHT=0 removes the height limit", async () => {
    process.env.WEBFROST_MEDIA_MAX_HEIGHT = "0";
    expect(await sortArg()).toBe("vcodec:h264,acodec:aac");
  });
});
