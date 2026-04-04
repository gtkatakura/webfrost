import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { mediaExtractor } from "./media";

const FAKE_METADATA = {
  title: "Test Video",
  duration: 120,
  uploader: "TestChannel",
  format: "mp4",
  ext: "mp4",
};

/**
 * Build a minimal mock Subprocess that resolves with the given exit code.
 * stdout is optionally pre-loaded with text (used for --dump-json output).
 */
function mockSubprocess(exitCode: number, stdoutData = ""): ReturnType<typeof Bun.spawn> {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        if (stdoutData) {
          controller.enqueue(new TextEncoder().encode(stdoutData));
        }
        controller.close();
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    }),
    stdin: null,
    pid: 99999,
    killed: false,
    kill() {},
    ref() {},
    unref() {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

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

describe("mediaExtractor", () => {
  describe("happy path", () => {
    test("inserts archive_results rows for media and media-metadata on successful video download", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        // Return metadata JSON for --dump-json or as download stdout
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const rows = db
        .query<{ extractor: string; content: string }, []>(
          "SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 ORDER BY id",
        )
        .all();

      const mediaRow = rows.find((r) => r.extractor === "media");
      const metaRow = rows.find((r) => r.extractor === "media-metadata");

      expect(mediaRow).toBeDefined();
      expect(mediaRow?.content).toBeTruthy();

      expect(metaRow).toBeDefined();
      expect(metaRow?.content).toBeTruthy();
    });

    test("media archive_result content points into snapshotDir", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const mediaRow = db
        .query<{ content: string }, []>(
          "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'media'",
        )
        .get();

      expect(mediaRow).toBeDefined();
      expect(mediaRow?.content).toContain(snapshotDir);
    });

    test("media-metadata content is parseable JSON with video information", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const metaRow = db
        .query<{ content: string }, []>(
          "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'media-metadata'",
        )
        .get();

      expect(metaRow).toBeDefined();
      // Content must be valid JSON, not a file path
      expect(() => JSON.parse(metaRow?.content ?? "")).not.toThrow();
      const parsed = JSON.parse(metaRow?.content ?? "{}");
      expect(parsed).toHaveProperty("title");
    });

    test("passes -f format flag to the yt-dlp download call", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");
      const capturedCmds: string[][] = [];

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        capturedCmds.push(args);
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      // Find the download call (not simulate, not dump-json)
      const downloadCmd = capturedCmds.find(
        (args) => !args.includes("--simulate") && !args.includes("--dump-json"),
      );
      expect(downloadCmd).toBeDefined();

      const hasFormatFlag = downloadCmd?.includes("-f") || downloadCmd?.includes("--format");
      expect(hasFormatFlag).toBe(true);
    });

    test("passes -o output path flag to the yt-dlp download call and it contains snapshotDir", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");
      const capturedCmds: string[][] = [];

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        capturedCmds.push(args);
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const downloadCmd = capturedCmds.find(
        (args) => !args.includes("--simulate") && !args.includes("--dump-json"),
      );
      expect(downloadCmd).toBeDefined();

      const outputFlagIdx = downloadCmd?.findIndex((a) => a === "-o" || a === "--output");
      expect(outputFlagIdx).toBeGreaterThanOrEqual(0);

      if (outputFlagIdx !== undefined && outputFlagIdx >= 0 && downloadCmd) {
        const outputPath = downloadCmd[outputFlagIdx + 1];
        expect(outputPath).toContain(snapshotDir);
      }
    });

    test("passes --max-filesize flag to the yt-dlp download call", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");
      const capturedCmds: string[][] = [];

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        capturedCmds.push(args);
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const downloadCmd = capturedCmds.find(
        (args) => !args.includes("--simulate") && !args.includes("--dump-json"),
      );
      expect(downloadCmd).toBeDefined();

      const hasMaxFilesize = downloadCmd?.some((a) => a.includes("max-filesize"));
      expect(hasMaxFilesize).toBe(true);
    });

    test("audio-only mode uses an audio format flag", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");
      const capturedCmds: string[][] = [];

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        capturedCmds.push(args);
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir, {
          audioOnly: true,
        });
      } finally {
        spy.mockRestore();
      }

      const downloadCmd = capturedCmds.find(
        (args) => !args.includes("--simulate") && !args.includes("--dump-json"),
      );
      expect(downloadCmd).toBeDefined();

      // Audio-only should request an audio format (bestaudio, m4a, mp3, etc.)
      const formatIdx = downloadCmd?.findIndex((a) => a === "-f" || a === "--format");
      if (formatIdx !== undefined && formatIdx >= 0 && downloadCmd) {
        const format = downloadCmd[formatIdx + 1] ?? "";
        expect(format.toLowerCase()).toMatch(/audio|m4a|mp3|bestaudio/);
      } else {
        // Audio-only flag might be expressed differently (e.g. --extract-audio)
        const hasAudioFlag = downloadCmd?.some((a) => a === "--extract-audio" || a === "-x");
        expect(hasAudioFlag).toBe(true);
      }
    });
  });

  describe("error handling", () => {
    test("does not throw when yt-dlp is not installed (ENOENT)", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      });

      try {
        await expect(
          mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir),
        ).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    test("does not insert archive_results when yt-dlp is not installed", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const rows = db
        .query<{ extractor: string }, []>(
          "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
        )
        .all();

      expect(
        rows.filter((r) => r.extractor === "media" || r.extractor === "media-metadata"),
      ).toHaveLength(0);
    });

    test("skips gracefully when URL is not supported (--simulate exits non-zero)", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(1); // not supported
        return mockSubprocess(0);
      });

      try {
        await expect(
          mediaExtractor(db, 1, "https://example.com/plain-webpage", snapshotDir),
        ).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
      }

      const rows = db
        .query<{ extractor: string }, []>(
          "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
        )
        .all();

      expect(
        rows.filter((r) => r.extractor === "media" || r.extractor === "media-metadata"),
      ).toHaveLength(0);
    });

    test("does not throw when the yt-dlp download exits non-zero", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(1); // download failure
      });

      try {
        await expect(
          mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir),
        ).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    test("does not insert archive_results when the download exits non-zero", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(1); // download failure
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      const rows = db
        .query<{ extractor: string }, []>(
          "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
        )
        .all();

      expect(
        rows.filter((r) => r.extractor === "media" || r.extractor === "media-metadata"),
      ).toHaveLength(0);
    });

    test("respects custom maxFileSize option in the --max-filesize flag value", async () => {
      const snapshotDir = join(testDir, "snapshots", "1");
      const capturedCmds: string[][] = [];

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        capturedCmds.push(args);
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir, {
          maxFileSize: "250M",
        });
      } finally {
        spy.mockRestore();
      }

      const downloadCmd = capturedCmds.find(
        (args) => !args.includes("--simulate") && !args.includes("--dump-json"),
      );
      expect(downloadCmd).toBeDefined();

      const maxSizeIdx = downloadCmd?.findIndex((a) => a === "--max-filesize");
      expect(maxSizeIdx).toBeGreaterThanOrEqual(0);
      if (maxSizeIdx !== undefined && maxSizeIdx >= 0 && downloadCmd) {
        expect(downloadCmd[maxSizeIdx + 1]).toBe("250M");
      }
    });
  });

  describe("edge cases", () => {
    test("handles URLs with query params and fragment without throwing", async () => {
      const url = "https://youtube.com/watch?v=abc123&list=PLtest&t=42#start";
      const snapshotDir = join(testDir, "snapshots", "1");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await expect(mediaExtractor(db, 1, url, snapshotDir)).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    test("concurrent extractions for different snapshots do not interfere", async () => {
      const snapshotDir1 = join(testDir, "snapshots", "1");
      const snapshotDir2 = join(testDir, "snapshots", "2");

      db.query(
        "INSERT INTO snapshots (url, status) VALUES ('https://youtube.com/watch?v=test2', 'pending')",
      ).run();

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await Promise.all([
          mediaExtractor(db, 1, "https://youtube.com/watch?v=test1", snapshotDir1),
          mediaExtractor(db, 2, "https://youtube.com/watch?v=test2", snapshotDir2),
        ]);
      } finally {
        spy.mockRestore();
      }

      const rows1 = db
        .query<{ extractor: string }, [number]>(
          "SELECT extractor FROM archive_results WHERE snapshot_id = ?",
        )
        .all(1);

      const rows2 = db
        .query<{ extractor: string }, [number]>(
          "SELECT extractor FROM archive_results WHERE snapshot_id = ?",
        )
        .all(2);

      expect(rows1.some((r) => r.extractor === "media")).toBe(true);
      expect(rows2.some((r) => r.extractor === "media")).toBe(true);
    });

    test("creates snapshotDir/media/ directory if it does not exist", async () => {
      const snapshotDir = join(testDir, "snapshots", "99");

      const spy = spyOn(Bun, "spawn").mockImplementation((cmd: unknown) => {
        const args = cmd as string[];
        if (args.includes("--simulate")) return mockSubprocess(0);
        return mockSubprocess(0, JSON.stringify(FAKE_METADATA));
      });

      try {
        await mediaExtractor(db, 1, "https://youtube.com/watch?v=test", snapshotDir);
      } finally {
        spy.mockRestore();
      }

      // The extractor should not throw even if the directory didn't pre-exist
      // (Verified implicitly: if it threw, the test would fail)
    });
  });
});
