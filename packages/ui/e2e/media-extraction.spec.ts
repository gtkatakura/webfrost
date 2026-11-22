import { spawnSync } from "node:child_process";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

/**
 * Media extraction E2E tests — @media
 *
 * Validates that the media extractor pipeline (yt-dlp) really works end-to-end:
 *   POST snapshot → pipeline runs → media file archived → download via API
 *
 * These tests hit the real server with a real yt-dlp invocation.
 * They are skipped automatically when yt-dlp is not installed in the environment.
 *
 * Covers these acceptance criteria:
 *   1. YouTube video extraction — file downloaded, content-type, size > 0
 *   2. Metadata extraction     — valid JSON with title, duration, uploader
 *   3. Non-media URL skip      — snapshot completes, no media extractor entry
 *   4. yt-dlp unavailable      — skipped (requires PATH manipulation, not E2E-safe)
 *   5. Magic bytes check       — downloaded file is a real mp4/mp3
 */

const API = "http://localhost:3000";

// Short Creative Commons YouTube clip (jNQXAC9IVRw — "Me at the zoo", 18s, first YouTube video).
// Extremely stable: it will not be removed.
const YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

// Regular HTML page — no media extractor should fire for this.

// MP4 magic bytes: ftyp box at offset 4 (bytes 4–7 = 0x66 0x74 0x79 0x70)
// or starts with ISO BMFF (0x00 0x00 0x00 ... 0x66 0x74 0x79 0x70)
function isMp4(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const ftyp = buf.slice(4, 8).toString("ascii");
  return ftyp === "ftyp";
}

// MP3 magic bytes: ID3 header (0x49 0x44 0x33) or sync word (0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2)
function isMp3(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // ID3
  if (buf[0] === 0xff && (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)) return true;
  return false;
}

type SnapshotDetail = {
  id: number;
  url: string;
  status: string;
  archiveResults: Array<{ extractor: string; content: string }>;
};

/** Poll GET /api/v1/snapshots/:id until status is 'done' or timeout. */
async function waitForDone(
  request: import("@playwright/test").APIRequestContext,
  id: number,
  timeoutMs = 120_000,
): Promise<SnapshotDetail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await request.get(`${API}/api/v1/snapshots/${id}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    if (body.status === "done" || body.status === "failed") {
      return body;
    }
    await new Promise((res) => setTimeout(res, 1_000));
  }
  throw new Error(`Snapshot ${id} did not reach 'done' within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Detect yt-dlp availability once before all tests in this suite.
// Tests that require yt-dlp skip themselves if it is not installed.
// ---------------------------------------------------------------------------

let ytDlpAvailable = false;

test.beforeAll(() => {
  try {
    const result = spawnSync("yt-dlp", ["--version"], { encoding: "utf8" });
    ytDlpAvailable = result.status === 0;
  } catch {
    ytDlpAvailable = false;
  }
});

// ---------------------------------------------------------------------------
// 1. YouTube video extraction
// ---------------------------------------------------------------------------

test("@media youtube: snapshot completes and media file is archived", async ({ request }) => {
  test.setTimeout(150_000); // yt-dlp download can take up to 120s

  if (!ytDlpAvailable) {
    test.skip(true, "yt-dlp not installed — skipping media extraction tests");
    return;
  }

  if (process.env.CI) {
    test.skip(
      true,
      "YouTube download tests skipped in CI — network unreliable for yt-dlp in GitHub Actions",
    );
    return;
  }

  const postResp = await request.post(`${API}/api/v1/snapshots`, {
    data: { url: YOUTUBE_VIDEO_URL },
  });
  expect(postResp.status()).toBe(202);
  const { id } = await postResp.json();

  // Wait up to 120s for yt-dlp to finish downloading the 18s video.
  const snapshot = await waitForDone(request, id, 120_000);

  expect(snapshot.status).toBe("done");

  const extractors = snapshot.archiveResults.map((r) => r.extractor);
  expect(extractors).toContain("media");
  expect(extractors).toContain("media-metadata");
});

// ---------------------------------------------------------------------------
// 2. Media file download — content-type and non-zero size
// ---------------------------------------------------------------------------

test("@media youtube: media download has correct content-type and non-zero size", async ({
  request,
}) => {
  test.setTimeout(150_000); // yt-dlp download can take up to 120s

  if (!ytDlpAvailable) {
    test.skip(true, "yt-dlp not installed — skipping media extraction tests");
    return;
  }

  if (process.env.CI) {
    test.skip(
      true,
      "YouTube download tests skipped in CI — network unreliable for yt-dlp in GitHub Actions",
    );
    return;
  }

  // Create and wait for a fresh snapshot.
  const postResp = await request.post(`${API}/api/v1/snapshots`, {
    data: { url: YOUTUBE_VIDEO_URL },
  });
  expect(postResp.status()).toBe(202);
  const { id } = await postResp.json();
  const snapshot = await waitForDone(request, id, 120_000);
  expect(snapshot.status).toBe("done");

  const mediaResult = snapshot.archiveResults.find((r) => r.extractor === "media");
  expect(mediaResult).toBeDefined();

  const dlResp = await request.get(`${API}/api/v1/snapshots/${id}/archives/media/download`);
  expect(dlResp.status()).toBe(200);

  const contentType = dlResp.headers()["content-type"] ?? "";
  expect(contentType).toMatch(/^(video\/mp4|audio\/mpeg)/);

  const body = await dlResp.body();
  expect(body.length).toBeGreaterThan(0);

  // Verify it is actually a real media file using magic bytes.
  const buf = Buffer.from(body);
  const isValidMedia = isMp4(buf) || isMp3(buf);
  expect(isValidMedia).toBe(true);
});

// ---------------------------------------------------------------------------
// 3. Metadata extraction — valid JSON with required fields
// ---------------------------------------------------------------------------

test("@media youtube: media-metadata download returns valid JSON with title, duration, uploader", async ({
  request,
}) => {
  test.setTimeout(150_000); // yt-dlp download can take up to 120s

  if (!ytDlpAvailable) {
    test.skip(true, "yt-dlp not installed — skipping media extraction tests");
    return;
  }

  if (process.env.CI) {
    test.skip(
      true,
      "YouTube download tests skipped in CI — network unreliable for yt-dlp in GitHub Actions",
    );
    return;
  }

  const postResp = await request.post(`${API}/api/v1/snapshots`, {
    data: { url: YOUTUBE_VIDEO_URL },
  });
  expect(postResp.status()).toBe(202);
  const { id } = await postResp.json();
  const snapshot = await waitForDone(request, id, 120_000);
  expect(snapshot.status).toBe("done");

  const metaResult = snapshot.archiveResults.find((r) => r.extractor === "media-metadata");
  expect(metaResult).toBeDefined();

  const dlResp = await request.get(
    `${API}/api/v1/snapshots/${id}/archives/media-metadata/download`,
  );
  expect(dlResp.status()).toBe(200);
  expect(dlResp.headers()["content-type"]).toContain("application/json");

  const meta = await dlResp.json();
  expect(typeof meta.title).toBe("string");
  expect(meta.title.length).toBeGreaterThan(0);
  expect(typeof meta.duration).toBe("number");
  expect(meta.duration).toBeGreaterThan(0);
  expect(typeof meta.uploader).toBe("string");
  expect(meta.uploader.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 4. Non-media URL — graceful skip, other extractors still work
// ---------------------------------------------------------------------------

test("@media non-media-url: snapshot completes without media extractor entry", async ({
  request,
}) => {
  // A plain page served by the test itself (the :3000 test server allows private URLs): no
  // dependence on the internet, and no queue behind other archives of the same public host.
  const page: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Plain page</title><p>No video here, just text.</p>");
  });
  await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(page.address() as AddressInfo).port}/`;
  try {
    const postResp = await request.post(`${API}/api/v1/snapshots`, { data: { url } });
    expect(postResp.status()).toBe(202);
    const { id } = await postResp.json();
    const snapshot = await waitForDone(request, id, 30_000);

    expect(snapshot.status).toBe("done");

    const extractors = snapshot.archiveResults.map((r) => r.extractor);

    // No media extractor should fire for a plain HTML page.
    expect(extractors).not.toContain("media");
    expect(extractors).not.toContain("media-metadata");

    // Other extractors should still have run (at minimum html).
    expect(extractors.length).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => page.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// 5. yt-dlp unavailable — skipped (requires PATH manipulation, not E2E-safe)
//
// This scenario is covered in unit tests (media.test.ts) where the spawner
// can be injected. E2E cannot safely manipulate PATH without affecting the
// server process, so we validate the unit-test coverage is sufficient.
// ---------------------------------------------------------------------------

test.skip("@media yt-dlp-unavailable: snapshot still completes when yt-dlp is not in PATH", async () => {
  // Covered by unit tests in packages/core/src/extractors/media.test.ts.
  // The ENOENT path in mediaExtractor() logs a warning and returns without
  // inserting any archive_results rows, so the pipeline continues normally.
});
