/**
 * Page load time benchmark — time-to-interactive for the snapshot list page.
 *
 * Spins up a minimal Bun HTTP server that:
 *   - Serves an inline HTML page that calls GET /api/v1/snapshots on load
 *   - Returns fake snapshot data from /api/v1/snapshots
 *
 * Playwright navigates to the page and reads window.performance.timing to
 * report navigationStart → loadEventEnd (page load) and the time until the
 * snapshot list becomes visible (TTI proxy).
 *
 * Requires Chromium to be installed:
 *   bunx playwright install --with-deps chromium
 *
 * Run: bun bench/page-load.ts
 */
import { chromium } from "playwright";

const ITERATIONS = 10;
const SNAPSHOT_COUNT = 50;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------
const snapshots = JSON.stringify(
  Array.from({ length: SNAPSHOT_COUNT }, (_, i) => ({
    id: i + 1,
    url: `https://example.com/page-${i + 1}`,
    status: "done",
    createdAt: "2026-04-01T00:00:00.000Z",
  })),
);

// Minimal HTML that mimics the app's snapshot-list load pattern:
//   1. Page loads
//   2. JS calls GET /api/v1/snapshots
//   3. Renders a list item per snapshot
//   4. Sets window.__loaded = true when done
const PAGE_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>WebFrost bench</title></head>
<body>
<ul id="list"></ul>
<script>
  fetch("/api/v1/snapshots")
    .then(r => r.json())
    .then(data => {
      const ul = document.getElementById("list");
      for (const s of data) {
        const li = document.createElement("li");
        li.textContent = s.url + " — " + s.status;
        ul.appendChild(li);
      }
      window.__loaded = true;
    });
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/v1/snapshots") {
      return new Response(snapshots, {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(PAGE_HTML, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

const baseUrl = `http://localhost:${server.port}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------
console.log("WebFrost page load benchmark");
console.log(`Server: ${baseUrl}`);
console.log(`Snapshots in list: ${SNAPSHOT_COUNT}`);
console.log(`Iterations: ${ITERATIONS}\n`);

const browser = await chromium.launch({ headless: true });

const pageLoadSamples: number[] = [];
const ttiSamples: number[] = [];

for (let i = 0; i < ITERATIONS; i++) {
  const page = await browser.newPage();
  // Start timing from before navigation
  const navStart = performance.now();
  await page.goto(baseUrl, { waitUntil: "load" });

  // Wait until the JS fetch resolves and items are rendered
  await page.waitForFunction(
    () => (window as unknown as { __loaded?: boolean }).__loaded === true,
    {
      timeout: 5000,
    },
  );
  const ttiMs = performance.now() - navStart;

  // Read browser-side navigation timing (loadEventEnd - navigationStart)
  const loadMs = await page.evaluate(() => {
    const t = window.performance.timing;
    return t.loadEventEnd - t.navigationStart;
  });

  pageLoadSamples.push(loadMs);
  ttiSamples.push(ttiMs);
  await page.close();
}

await browser.close();
server.stop();

pageLoadSamples.sort((a, b) => a - b);
ttiSamples.sort((a, b) => a - b);

console.log(`=== Page load (loadEventEnd - navigationStart, n=${ITERATIONS}) ===`);
console.log(`  p50: ${percentile(pageLoadSamples, 50).toFixed(1)} ms`);
console.log(`  p95: ${percentile(pageLoadSamples, 95).toFixed(1)} ms`);
console.log(`  p99: ${percentile(pageLoadSamples, 99).toFixed(1)} ms`);
console.log(
  `  min: ${pageLoadSamples[0]?.toFixed(1)} ms  max: ${pageLoadSamples[pageLoadSamples.length - 1]?.toFixed(1)} ms`,
);

console.log(`\n=== TTI proxy (nav → list visible, n=${ITERATIONS}) ===`);
console.log(`  p50: ${percentile(ttiSamples, 50).toFixed(1)} ms`);
console.log(`  p95: ${percentile(ttiSamples, 95).toFixed(1)} ms`);
console.log(`  p99: ${percentile(ttiSamples, 99).toFixed(1)} ms`);
console.log(
  `  min: ${ttiSamples[0]?.toFixed(1)} ms  max: ${ttiSamples[ttiSamples.length - 1]?.toFixed(1)} ms`,
);
