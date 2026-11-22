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
  return {
    screenshot: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

type ShotOptions = {
  path?: string;
  type?: string;
  quality?: number;
  fullPage?: boolean;
  clip?: unknown;
};

/** A page stub that writes a file per screenshot, records the options and reports `scrollHeight`. */
function makeRecordingPage(scrollHeight: number) {
  const shots: ShotOptions[] = [];
  const page = {
    screenshot: async (opts: ShotOptions) => {
      shots.push(opts);
      await Bun.write(opts.path as string, new Uint8Array([1, 2, 3]));
    },
    evaluate: async () => scrollHeight,
    viewportSize: () => ({ width: 1000, height: 800 }),
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

  test("records the thumbnail (viewport JPEG, quality 60) and then the full-page PNG", async () => {
    const { page, shots } = makeRecordingPage(3000);
    await screenshotExtractor(db, 1, makeStorage(), page);

    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({ type: "jpeg", quality: 60 });
    expect(shots[0]?.fullPage).toBeUndefined();
    expect(shots[0]?.path).toEndWith("thumbnail.jpg");
    expect(shots[1]).toMatchObject({ fullPage: true });
    expect(shots[1]?.path).toEndWith("screenshot.png");

    const rows = await db.all<{ extractor: string; error: string | null; size_bytes: number }>(
      sql`SELECT extractor, error, size_bytes FROM archive_results WHERE snapshot_id = 1 ORDER BY id`,
    );
    expect(rows.map((r) => r.extractor)).toEqual(["thumbnail", "screenshot"]);
    expect(rows.every((r) => r.error === null && r.size_bytes === 3)).toBe(true);
  });

  test("keeps the thumbnail when the full-page shot fails", async () => {
    const { page } = makeRecordingPage(3000);
    let calls = 0;
    const original = page.screenshot.bind(page);
    (page as unknown as { screenshot: unknown }).screenshot = async (o: ShotOptions) => {
      if (++calls === 2) throw new Error("too tall");
      return original(o as never);
    };
    await expect(screenshotExtractor(db, 1, makeStorage(), page)).rejects.toThrow("too tall");
    const rows = await db.all<{ extractor: string }>(
      sql`SELECT extractor FROM archive_results WHERE snapshot_id = 1`,
    );
    expect(rows.map((r) => r.extractor)).toEqual(["thumbnail"]);
  });

  test("cuts a page taller than the limit with a clip", async () => {
    const { page, shots } = makeRecordingPage(MAX_SCREENSHOT_HEIGHT + 1);
    await screenshotExtractor(db, 1, makeStorage(), page);
    expect(shots[1]).toMatchObject({
      fullPage: true,
      clip: { x: 0, y: 0, width: 1000, height: MAX_SCREENSHOT_HEIGHT },
    });
  });

  test("does not clip a page exactly at the limit", async () => {
    const { page, shots } = makeRecordingPage(MAX_SCREENSHOT_HEIGHT);
    await screenshotExtractor(db, 1, makeStorage(), page);
    expect(shots[1]?.clip).toBeUndefined();
    expect(shots[1]?.fullPage).toBe(true);
  });
});
