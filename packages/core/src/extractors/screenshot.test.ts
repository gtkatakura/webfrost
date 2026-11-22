import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import type { Page } from "playwright";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { MAX_SCREENSHOT_HEIGHT, screenshotExtractor } from "./screenshot";

/** Minimal Page stub whose screenshot() always throws (simulates Playwright unavailable). */
function makeFailingPage(): Page {
  const fail = async () => {
    throw new Error("Playwright unavailable (stub)");
  };
  return {
    screenshot: fail,
    viewportSize: () => ({ width: 1000, height: 800 }),
    context: () => ({ newCDPSession: fail }),
  } as unknown as Page;
}

type ShotOptions = {
  path?: string;
  type?: string;
  quality?: number;
  fullPage?: boolean;
  clip?: unknown;
  timeout?: number;
};

/** A page stub that writes a file per screenshot, records the options and reports `scrollHeight`. */
function makeRecordingPage(scrollHeight: number) {
  const shots: ShotOptions[] = [];
  // The thumbnail is taken through the DevTools protocol (WebP, scaled); recorded here as a shot too.
  const cdp = {
    send: async (method: string, params: Record<string, unknown>) => {
      shots.push({ method, ...params } as ShotOptions);
      return { data: Buffer.from([1, 2, 3]).toString("base64") };
    },
    detach: async () => {},
  };
  const page = {
    context: () => ({ newCDPSession: async () => cdp }),
    screenshot: async (opts: ShotOptions) => {
      shots.push(opts);
      await Bun.write(opts.path as string, new Uint8Array([1, 2, 3]));
    },
    evaluate: async () => scrollHeight,
    viewportSize: () => ({ width: 1000, height: 800 }),
    setViewportSize: async (size: { width: number; height: number }) => {
      shots.push({ viewport: size } as ShotOptions);
    },
  } as unknown as Page;
  return { page, shots };
}

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `screenshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')`);
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

describe("screenshotExtractor", () => {
  test("rejects when page.screenshot() fails so the pipeline can record the failure", async () => {
    const page = makeFailingPage();

    await expect(screenshotExtractor(db, 1, makeStorage(), page)).rejects.toThrow(
      "Playwright unavailable",
    );
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await screenshotExtractor(db, 1, makeStorage(), page).catch(() => {});

    const rows = await db.all<{ extractor: string }>(
      sql`SELECT extractor FROM archive_results WHERE snapshot_id = 1`,
    );

    const screenshotRow = rows.find((r) => r.extractor === "screenshot");
    expect(screenshotRow).toBeUndefined();
  });

  test("records the thumbnail (first screen as WebP at half size) and then the full-page PNG", async () => {
    const { page, shots } = makeRecordingPage(3000);
    await screenshotExtractor(db, 1, makeStorage(), page);

    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({
      method: "Page.captureScreenshot",
      format: "webp",
      clip: { x: 0, y: 0, width: 1000, height: 800, scale: 0.5 },
    });
    expect(shots[1]).toMatchObject({ fullPage: true });
    expect(shots[1]?.path).toEndWith("screenshot.png");

    const rows = await db.all<{ extractor: string; error: string | null; size_bytes: number }>(
      sql`SELECT extractor, error, size_bytes FROM archive_results WHERE snapshot_id = 1 ORDER BY id`,
    );
    expect(rows.map((r) => r.extractor)).toEqual(["thumbnail", "screenshot"]);
    expect(rows.every((r) => r.error === null && r.size_bytes === 3)).toBe(true);
  });

  test("gives the full-page shot the extractor's time budget minus 5 s", async () => {
    const saved = process.env.WEBFROST_EXTRACTOR_TIMEOUT_MS;
    try {
      // biome-ignore lint/performance/noDelete: an unset variable, not the string "undefined"
      delete process.env.WEBFROST_EXTRACTOR_TIMEOUT_MS;
      const a = makeRecordingPage(3000);
      await screenshotExtractor(db, 1, makeStorage(), a.page);
      expect(a.shots[1]).toMatchObject({ fullPage: true, timeout: 55_000 });

      process.env.WEBFROST_EXTRACTOR_TIMEOUT_MS = "20000";
      const b = makeRecordingPage(20_000);
      await screenshotExtractor(db, 1, makeStorage(), b.page);
      // [1] is the taller viewport; [2] is the shot itself.
      expect(b.shots[2]).toMatchObject({ timeout: 15_000 });
    } finally {
      // biome-ignore lint/performance/noDelete: restoring an unset variable
      if (saved === undefined) delete process.env.WEBFROST_EXTRACTOR_TIMEOUT_MS;
      else process.env.WEBFROST_EXTRACTOR_TIMEOUT_MS = saved;
    }
  });

  test("keeps the thumbnail when the full-page shot fails", async () => {
    const { page } = makeRecordingPage(3000);
    let calls = 0;
    const original = page.screenshot.bind(page);
    (page as unknown as { screenshot: unknown }).screenshot = async (o: ShotOptions) => {
      // The thumbnail goes through the DevTools protocol; the first screenshot() is the full page.
      if (++calls === 1) throw new Error("too tall");
      return original(o as never);
    };
    await expect(screenshotExtractor(db, 1, makeStorage(), page)).rejects.toThrow("too tall");
    const rows = await db.all<{ extractor: string }>(
      sql`SELECT extractor FROM archive_results WHERE snapshot_id = 1`,
    );
    expect(rows.map((r) => r.extractor)).toEqual(["thumbnail"]);
  });

  test("shoots a page taller than the limit through a viewport as tall as the limit, then restores it", async () => {
    const { page, shots } = makeRecordingPage(MAX_SCREENSHOT_HEIGHT + 1);
    await screenshotExtractor(db, 1, makeStorage(), page);
    // [0] thumbnail, then: grow the viewport, shoot it (not the full page), put it back.
    expect(shots[1]).toEqual({ viewport: { width: 1000, height: MAX_SCREENSHOT_HEIGHT } } as never);
    expect(shots[2]?.fullPage).toBeUndefined();
    expect(shots[2]?.path).toEndWith("screenshot.png");
    expect(shots[3]).toEqual({ viewport: { width: 1000, height: 800 } } as never);
  });

  test("does not clip a page exactly at the limit", async () => {
    const { page, shots } = makeRecordingPage(MAX_SCREENSHOT_HEIGHT);
    await screenshotExtractor(db, 1, makeStorage(), page);
    expect(shots[1]?.clip).toBeUndefined();
    expect(shots[1]?.fullPage).toBe(true);
  });
});
