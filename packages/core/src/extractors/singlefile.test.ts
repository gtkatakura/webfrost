import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { inlineAssets, singleFileExtractor } from "./singlefile";

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
  // Allow localhost so in-process test servers pass the SSRF guard
  process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  testDir = join(tmpdir(), `singlefile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')").run();
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

describe("singleFileExtractor", () => {
  test("rejects when page.content() fails so the pipeline can record the failure", async () => {
    const page = makeFailingPage();

    await expect(singleFileExtractor(db, 1, makeStorage(), page)).rejects.toThrow(
      "Playwright unavailable",
    );
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await singleFileExtractor(db, 1, makeStorage(), page).catch(() => {});

    const row = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1 AND extractor = 'singlefile'",
      )
      .get();

    expect(row).toBeNull();
  });

  test("writes singlefile.html and inserts archive_result row on success", async () => {
    const html = "<html><body><p>Hello world</p></body></html>";
    const page = makeSuccessPage(html);

    await singleFileExtractor(db, 1, makeStorage(), page);

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

    await singleFileExtractor(db, 1, makeStorage(), page);
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

    await singleFileExtractor(db, 1, makeStorage(), page);
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

    await singleFileExtractor(db, 1, makeStorage(), page);
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
    const html =
      '<html><head><link rel="stylesheet" href="https://nonexistent.invalid/style.css"></head><body></body></html>';
    const page = makeSuccessPage(html);

    // Should not throw even if fetch fails
    await expect(singleFileExtractor(db, 1, makeStorage(), page)).resolves.toBeUndefined();

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

describe("singleFileExtractor — cancellation", () => {
  test("stores nothing once the pipeline has given up on it", async () => {
    const page = {
      url: () => "https://example.com/",
      content: async () => "<html><body>slow page</body></html>",
    } as unknown as Page;

    await expect(
      singleFileExtractor(db, 1, makeStorage(), page, AbortSignal.abort()),
    ).rejects.toThrow();

    const rows = db.query<{ extractor: string }, []>("SELECT extractor FROM archive_results").all();
    expect(rows).toHaveLength(0);
  });
});

describe("inlineAssets", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let inFlight = 0;
  let maxInFlight = 0;

  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/dollar.css") {
          // `$'` and `$&` are special in a String.replace replacement string.
          return new Response(`a::after { content: "$' and $& and $$"; }`, {
            headers: { "content-type": "text/css" },
          });
        }
        if (pathname.startsWith("/img/")) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Bun.sleep(20);
          inFlight--;
          return new Response(new Uint8Array(1000).fill(7), {
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    server.stop(true);
    for (const key of ["WEBFROST_SINGLEFILE_MAX_BYTES", "WEBFROST_SINGLEFILE_CONCURRENCY"]) {
      Reflect.deleteProperty(process.env, key);
    }
  });

  test("inlines CSS literally: $' and $& in the stylesheet are not expanded", async () => {
    const html = `<head><link rel="stylesheet" href="/dollar.css"></head><body>tail</body>`;
    const out = await inlineAssets(html, `${base}/`);
    expect(out).toBe(
      `<head><style>a::after { content: "$' and $& and $$"; }</style></head><body>tail</body>`,
    );
  });

  test("replaces every occurrence of a repeated tag, not just the first", async () => {
    const tag = `<link rel="stylesheet" href="/dollar.css">`;
    const out = await inlineAssets(`${tag}<p>x</p>${tag}`, `${base}/`);
    expect(out).not.toContain("<link");
    expect(out.match(/<style>/g)).toHaveLength(2);

    const img = `<img src="/img/a.png">`;
    const outImg = await inlineAssets(`${img}${img}`, `${base}/`);
    expect(outImg.match(/data:image\/png;base64,/g)).toHaveLength(2);
  });

  test("never downloads more than 8 assets at once", async () => {
    const html = Array.from({ length: 40 }, (_, i) => `<img src="/img/${i}.png">`).join("");
    const out = await inlineAssets(html, `${base}/`);
    expect(out.match(/data:image\/png/g)).toHaveLength(40);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test("stops inlining at the byte budget and leaves the rest as remote URLs", async () => {
    process.env.WEBFROST_SINGLEFILE_MAX_BYTES = "2500"; // room for two 1000-byte images
    process.env.WEBFROST_SINGLEFILE_CONCURRENCY = "1"; // deterministic order
    const html = Array.from({ length: 5 }, (_, i) => `<img src="/img/${i}.png">`).join("");
    const out = await inlineAssets(html, `${base}/`);
    expect(out.match(/data:image\/png/g)).toHaveLength(2);
    expect(out.match(/src="\/img\/\d\.png"/g)).toHaveLength(3);
  });

  test("an aborted signal leaves assets remote", async () => {
    const controller = new AbortController();
    controller.abort();
    const html = `<img src="/img/a.png">`;
    expect(await inlineAssets(html, `${base}/`, controller.signal)).toBe(html);
  });
});
