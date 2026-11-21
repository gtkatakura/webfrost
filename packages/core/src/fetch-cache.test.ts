import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FetchCache } from "./fetch-cache";

/** In-process HTTP server for tests — avoids external network calls. */
let server: ReturnType<typeof Bun.serve> | undefined;
let fetchCount = 0;

beforeEach(() => {
  // Allow localhost so in-process test servers pass the SSRF guard
  process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  fetchCount = 0;
  server = Bun.serve({
    port: 0, // random available port
    fetch() {
      fetchCount++;
      return new Response("<html><body>hello</body></html>", {
        headers: { "content-type": "text/html" },
      });
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  server?.stop(true);
  server = undefined;
});

describe("FetchCache", () => {
  test("fetches URL only once even when called twice for the same URL", async () => {
    const cache = new FetchCache();
    const url = `http://localhost:${server?.port}/page`;

    const [r1, r2] = await Promise.all([cache.get(url), cache.get(url)]);

    expect(r1.html).toBe("<html><body>hello</body></html>");
    expect(r2.html).toBe("<html><body>hello</body></html>");
    // Only 1 real HTTP request should have been made (deduplication via shared promise)
    expect(fetchCount).toBe(1);
  });

  test("fetches distinct URLs independently", async () => {
    const cache = new FetchCache();
    const url1 = `http://localhost:${server?.port}/a`;
    const url2 = `http://localhost:${server?.port}/b`;

    await cache.get(url1);
    await cache.get(url2);

    expect(fetchCount).toBe(2);
    expect(cache.size).toBe(2);
  });

  test("size reflects number of cached entries", async () => {
    const cache = new FetchCache();
    expect(cache.size).toBe(0);
    await cache.get(`http://localhost:${server?.port}/`);
    expect(cache.size).toBe(1);
  });

  test("returns status and headers", async () => {
    const cache = new FetchCache();
    const result = await cache.get(`http://localhost:${server?.port}/`);
    expect(result.status).toBe(200);
    expect(result.statusText).toBeDefined();
    expect(result.headers).toBeDefined();
  });
});
