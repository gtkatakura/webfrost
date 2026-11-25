import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import {
  type FrameGrabber,
  YT_DLP_BASE_ARGS,
  type YtDlpSpawner,
  mediaExtractor,
  posterSeconds,
  ytDlpError,
} from "./media";

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

  test("stays silent on a page no extractor handles (the generic one is switched off)", async () => {
    const spawner = makeSpawner([
      {
        exitCode: 1,
        stdout: "",
        stderr:
          "ERROR: No suitable extractor found for URL https://en.wikipedia.org/wiki/Internet_Archive\n",
      },
    ]);
    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://en.wikipedia.org/wiki/Internet_Archive", {
        _spawner: spawner,
      }),
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

  test("records a poster taken from a tenth of the way into the video", async () => {
    const calls: Array<{ video: string; out: string; seconds: number }> = [];
    const grabber: FrameGrabber = async (video, out, seconds) => {
      calls.push({ video, out, seconds });
      await Bun.write(out, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
      return true;
    };
    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: makeSpawner([META_OK, OK]),
      _frameGrabber: grabber,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.seconds).toBe(12); // duration 120 s
    expect(calls[0]?.video).toEndWith("media.mp4");
    expect(calls[0]?.out).toEndWith("poster.jpg");
    const rows = await archiveRows();
    const poster = rows.find((r) => r.extractor === "media-poster");
    expect(poster?.content).toContain("poster.jpg");
    expect(Bun.file(poster?.content as string).size).toBe(4);
    expect(rows.find((r) => r.extractor === "media")).toBeDefined();
  });

  test("keeps the video when no poster frame can be taken", async () => {
    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: makeSpawner([META_OK, OK]),
      _frameGrabber: async () => false,
    });
    const rows = await archiveRows();
    expect(rows.find((r) => r.extractor === "media-poster")).toBeUndefined();
    expect(rows.find((r) => r.extractor === "media")).toBeDefined();
  });

  test("posterSeconds: a tenth of the duration, at most 30 s, 3 s when unknown", () => {
    expect(posterSeconds(120)).toBe(12);
    expect(posterSeconds(10_000)).toBe(30);
    expect(posterSeconds(undefined)).toBe(3);
    expect(posterSeconds(0)).toBe(3);
    expect(posterSeconds("12")).toBe(3);
  });

  test.skipIf(!Bun.which("ffmpeg"))(
    "the default grabber writes a JPEG from a real video",
    async () => {
      const video = join(testDir, "tiny.mp4");
      const gen = Bun.spawnSync([
        "ffmpeg",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=2:size=320x240:rate=10",
        "-pix_fmt",
        "yuv420p",
        video,
      ]);
      expect(gen.exitCode).toBe(0);
      // yt-dlp is faked; the "downloaded" video is the generated one.
      const storage = makeStorage();
      const target = await storage.localPath(1, "media/media.mp4");
      await Bun.write(target, Bun.file(video));
      await mediaExtractor(db, 1, storage, "https://youtube.com/watch?v=test", {
        _spawner: makeSpawner([{ ...META_OK, stdout: '{"duration":2}' }, OK]),
      });
      const poster = (await archiveRows()).find((r) => r.extractor === "media-poster");
      expect(poster).toBeDefined();
      const bytes = new Uint8Array(await Bun.file(poster?.content as string).arrayBuffer());
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    },
  );

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

  test("keeps the metadata and fails with yt-dlp's reason when both video and audio downloads fail", async () => {
    const refused: SpawnResult = {
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: [youtube] test: Video unavailable\n",
    };
    const spawner = makeSpawner([
      META_OK, // metadata
      refused, // video fails
      FAIL, // audio fails
    ]);

    await expect(
      mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
        _spawner: spawner,
      }),
    ).rejects.toThrow("yt-dlp: test: Video unavailable");

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
    // Video and audio both fail here, so the extractor ends with an error; the arguments are what matter.
    await mediaExtractor(db, 1, makeStorage(), url, { _spawner: spawner }).catch(() => {});
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args.slice(0, YT_DLP_BASE_ARGS.length)).toEqual([...YT_DLP_BASE_ARGS]);
      expect(args).toContain("--ignore-config");
      expect(args).toContain("--no-playlist");
      expect(args[args.indexOf("--use-extractors") + 1]).toBe(
        "default,-generic,-mediasite,-mediasitecatalog,-mediasitenamedcatalog",
      );
      expect(args.slice(-2)).toEqual(["--", url]);
      // Every connection yt-dlp opens goes through the SSRF egress proxy (hostname sent, checked there).
      expect(args[args.indexOf("--proxy") + 1]).toMatch(/^socks5h:\/\/127\.0\.0\.1:\d+$/);
    }
    // One proxy for the whole extraction, closed at the end.
    const proxy = calls[0]?.[calls[0].indexOf("--proxy") + 1] ?? "";
    expect(calls.every((args) => args.includes(proxy))).toBe(true);
    const port = Number(proxy.split(":").at(-1));
    await expect(
      Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } }),
    ).rejects.toThrow();
  });

  test("the proxy yt-dlp is given refuses a private address", async () => {
    let proxy = "";
    let reply: number[] = [];
    const spawner: YtDlpSpawner = async (args) => {
      proxy = args[args.indexOf("--proxy") + 1] ?? "";
      // Ask the proxy, while yt-dlp would be running, for a loopback address, as SOCKS5 does.
      const port = Number(proxy.split(":").at(-1));
      reply = await new Promise<number[]>((resolve, reject) => {
        let step = 0;
        Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            open(socket) {
              socket.write(new Uint8Array([0x05, 0x01, 0x00]));
            },
            data(socket, data) {
              if (step++ === 0) {
                // CONNECT 127.0.0.1:80
                socket.write(new Uint8Array([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
              } else {
                resolve([...data]);
                socket.end();
              }
            },
            error(_socket, err) {
              reject(err);
            },
          },
        }).catch(reject);
      });
      return FAIL;
    };
    const saved = process.env.WEBFROST_ALLOW_PRIVATE_URLS;
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
    try {
      await mediaExtractor(db, 1, makeStorage(), "https://example.com/v", {
        _spawner: spawner,
      }).catch(() => {});
    } finally {
      if (saved !== undefined) process.env.WEBFROST_ALLOW_PRIVATE_URLS = saved;
    }
    expect(proxy).toStartWith("socks5h://127.0.0.1:");
    // A SOCKS5 reply, and not "succeeded" (0x00): the connection was refused.
    expect(reply[0]).toBe(0x05);
    expect(reply[1]).not.toBe(0x00);
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

  async function sortArg(flag = "-S"): Promise<string | undefined> {
    const calls: string[][] = [];
    const spawner: YtDlpSpawner = async (args) => {
      calls.push(args);
      return calls.length === 1 ? META_OK : OK;
    };
    await mediaExtractor(db, 1, makeStorage(), "https://youtube.com/watch?v=test", {
      _spawner: spawner,
    });
    const video = calls[1] ?? [];
    return video[video.indexOf(flag) + 1];
  }

  test("prefers up to 1080p, VP9 and Opus by default", async () => {
    Reflect.deleteProperty(process.env, "WEBFROST_MEDIA_MAX_HEIGHT");
    expect(await sortArg()).toBe("res:1080,vcodec:vp9,acodec:opus");
  });

  test("takes AVI, FLV and WMV only as a last resort", async () => {
    expect(await sortArg("-f")).toBe(
      "bv*[ext!=avi][ext!=flv][ext!=wmv]+ba/b[ext!=avi][ext!=flv][ext!=wmv]/bv*+ba/b",
    );
  });

  test("honours WEBFROST_MEDIA_MAX_HEIGHT", async () => {
    process.env.WEBFROST_MEDIA_MAX_HEIGHT = "720";
    expect(await sortArg()).toBe("res:720,vcodec:vp9,acodec:opus");
  });

  test("WEBFROST_MEDIA_MAX_HEIGHT=0 removes the height limit", async () => {
    process.env.WEBFROST_MEDIA_MAX_HEIGHT = "0";
    expect(await sortArg()).toBe("vcodec:vp9,acodec:opus");
  });
});
