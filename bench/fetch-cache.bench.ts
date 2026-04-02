/**
 * Benchmark: shared HTTP cache deduplication
 *
 * Demonstrates that FetchCache prevents duplicate HTTP requests within one
 * pipeline run. Baseline: N raw fetch() calls for the same URL. Optimized:
 * N calls via FetchCache — only 1 real HTTP request made.
 *
 * Results recorded 2026-04-02:
 *   baseline (3× raw fetch)  ~3x network round trips per iteration
 *   cached  (3× cache.get)  ~1x network round trip per iteration (2 saved)
 */
import { bench, run } from "mitata";
import { FetchCache } from "../packages/core/src/fetch-cache";

// In-process echo server — no external network dependency
const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("<html><body>bench</body></html>", {
      headers: { "content-type": "text/html" },
    });
  },
});

const URL = `http://localhost:${server.port}/page`;

bench("baseline: 3x raw fetch() for same URL", async () => {
  await fetch(URL);
  await fetch(URL);
  await fetch(URL);
});

bench("optimized: 3x FetchCache.get() for same URL (1 real fetch)", async () => {
  const cache = new FetchCache();
  await cache.get(URL);
  await cache.get(URL);
  await cache.get(URL);
  // cache.size === 1 — only one HTTP request was made
});

await run();
server.stop(true);
