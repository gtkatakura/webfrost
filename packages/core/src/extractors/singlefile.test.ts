import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
import { singleFileExtractor } from "./singlefile";

/** Minimal Page stub whose content() always throws. */
function makeFailingPage(): Page {
  return {
    url: () => "https://example.com",
    content: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

/** Minimal Page stub that returns fixed HTML. */
function makeSuccessPage(html: string, url = "https://example.com"): Page {
  return {
    url: () => url,
    content: async () => html,
  } as unknown as Page;
}

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `singlefile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')").run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("singleFileExtractor", () => {
  test("does not throw when page.content() fails (graceful degradation)", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await expect(singleFileExtractor(db, 1, snapshotDir, page)).resolves.toBeUndefined();
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const page = makeFailingPage();

    await singleFileExtractor(db, 1, snapshotDir, page);

    const row = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeNull();
  });

  test("writes singlefile.html and inserts archive_result row on success", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const html = "<html><body><p>Hello world</p></body></html>";
    const page = makeSuccessPage(html);

    await singleFileExtractor(db, 1, snapshotDir, page);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeDefined();
    expect(row?.content).toEndWith("singlefile.html");

    expect(row?.content).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    expect(written).toContain("Hello world");
  });

  test("rebases relative url() references in inlined CSS to absolute URLs", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const cssText = "body { background: url(../images/bg.png); color: red; }";

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/css/style.css") {
          return new Response(cssText, { headers: { "content-type": "text/css" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const base = `http://127.0.0.1:${server.port}`;
    const html = `<html><head><link rel="stylesheet" href="${base}/css/style.css"></head><body></body></html>`;
    const page = makeSuccessPage(html, `${base}/page.html`);

    await singleFileExtractor(db, 1, snapshotDir, page);
    server.stop(true);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    // Relative url() must be rebased to absolute
    expect(written).toContain(`url(${base}/images/bg.png)`);
    expect(written).not.toContain("url(../images/bg.png)");
  });

  test("inlines font files as base64 data URIs when rebasing CSS url() references", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const fakeFont = new Uint8Array([1, 2, 3, 4]);
    const cssText = "@font-face { src: url(../fonts/test.woff2); }";

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const pathname = new URL(req.url).pathname;
        if (pathname === "/css/style.css") {
          return new Response(cssText, { headers: { "content-type": "text/css" } });
        }
        if (pathname === "/fonts/test.woff2") {
          return new Response(fakeFont, { headers: { "content-type": "font/woff2" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const base = `http://127.0.0.1:${server.port}`;
    const html = `<html><head><link rel="stylesheet" href="${base}/css/style.css"></head><body></body></html>`;
    const page = makeSuccessPage(html, `${base}/page.html`);

    await singleFileExtractor(db, 1, snapshotDir, page);
    server.stop(true);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    // Font must be inlined as a data URI
    expect(written).toContain("data:font/woff2;base64,");
    expect(written).not.toContain("url(../fonts/test.woff2)");
  });

  test("falls back to absolute URL when font fetch fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const cssText = "@font-face { src: url(../fonts/missing.woff2); }";

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const pathname = new URL(req.url).pathname;
        if (pathname === "/css/style.css") {
          return new Response(cssText, { headers: { "content-type": "text/css" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const base = `http://127.0.0.1:${server.port}`;
    const html = `<html><head><link rel="stylesheet" href="${base}/css/style.css"></head><body></body></html>`;
    const page = makeSuccessPage(html, `${base}/page.html`);

    await singleFileExtractor(db, 1, snapshotDir, page);
    server.stop(true);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    // Falls back to absolute URL when font fetch returns 404
    expect(written).toContain(`url(${base}/fonts/missing.woff2)`);
    expect(written).not.toContain("url(../fonts/missing.woff2)");
  });

  test("leaves link[rel=stylesheet] unchanged when fetch fails", async () => {
    const snapshotDir = join(testDir, "snapshots", "1");
    const html =
      '<html><head><link rel="stylesheet" href="https://nonexistent.invalid/style.css"></head><body></body></html>';
    const page = makeSuccessPage(html);

    // Should not throw even if fetch fails
    await expect(singleFileExtractor(db, 1, snapshotDir, page)).resolves.toBeUndefined();

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    // File should still be written with the original link intact
    expect(row).toBeDefined();
    expect(row?.content).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    expect(written).toContain("nonexistent.invalid");
  });
});
