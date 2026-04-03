/**
 * Benchmark: webfrost add — full pipeline vs singlefile-only processing
 *
 * Simulates archiving a page equivalent to:
 *   https://www.yegor256.com/2017/03/28/solid.html
 *
 * Compares two approaches:
 *
 *   A. Full add  — `addUrl()` end-to-end: HTTP fetch → Playwright browser
 *      navigation → all seven extractors (html, WARC, readability, PDF,
 *      screenshot, DOM snapshot, singlefile).
 *
 *   B. Singlefile-only — pre-cached HTML, no Playwright. Runs only the three
 *      lightweight extractors (html, WARC, readability). This models the cost
 *      of indexing a page whose HTML you already have locally.
 *
 * Results are written to stdout. When $GITHUB_STEP_SUMMARY is set (CI),
 * a Markdown table is also appended to the job summary.
 *
 * Run locally:
 *   WEBFROST_ALLOW_PRIVATE_URLS=true bun bench/cli-add.bench.ts
 */

// Allow loopback connections so the local test server is reachable via addUrl()
process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";

import { appendFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FetchCache, addUrl, createSnapshot, openDb } from "../packages/core/src";
import { htmlExtractor } from "../packages/core/src/extractors/html";
import { readabilityExtractor } from "../packages/core/src/extractors/readability";
import { warcExtractor } from "../packages/core/src/extractors/warc";

// ---------------------------------------------------------------------------
// Local HTTP server — serves a representative article page (SOLID article)
// ---------------------------------------------------------------------------
const SOLID_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="author" content="Yegor Bugayenko">
  <title>SOLID Is OOP for Dummies — Yegor Bugayenko</title>
</head>
<body>
  <article>
    <h1>SOLID Is OOP for Dummies</h1>
    <p>Published: 28 March 2017 by Yegor Bugayenko</p>
    <p>Every serious programmer knows about SOLID — a set of five design principles
    introduced by Robert Martin in his 2000 paper "Design Principles and Design
    Patterns". The acronym stands for Single Responsibility, Open/Closed, Liskov
    Substitution, Interface Segregation, and Dependency Inversion.</p>
    <p>These principles are useful guidelines but are often misunderstood or misapplied
    in modern object-oriented design. True OOP should focus on objects that model
    real-world entities, not procedural scripts dressed up in class syntax.</p>
    <p>The problem with SOLID is that it describes how to patch a fundamentally broken
    design style rather than fixing its root cause. Real OOP, as envisioned by Alan Kay,
    is about message passing between autonomous objects — not about dependency injection
    containers and interface segregation checklists.</p>
  </article>
</body>
</html>`;

const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(SOLID_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

const localUrl = `http://127.0.0.1:${server.port}/solid`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function makeTempDir(label: string): Promise<string> {
  const dir = join(tmpdir(), `webfrost-bench-${label}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

// ---------------------------------------------------------------------------
// Benchmark A — full add (HTTP fetch + Playwright + all seven extractors)
// ---------------------------------------------------------------------------
console.log("\nBenchmark A: webfrost add <url>  (full pipeline — fetch + Playwright + extractors)");
const addDir = await makeTempDir("add");
const addDb = openDb(addDir);

const t0 = performance.now();
await addUrl(addDb, localUrl, addDir);
const addMs = performance.now() - t0;

addDb.close();
await rm(addDir, { recursive: true, force: true });
console.log(`  → ${fmt(addMs)}`);

// ---------------------------------------------------------------------------
// Benchmark B — singlefile-only (pre-cached HTML, no Playwright)
//
// Pre-fetch the HTML once outside the timed window, then run only the three
// lightweight extractors. This models processing an already-downloaded
// singlefile.html without launching a browser.
// ---------------------------------------------------------------------------
console.log("\nBenchmark B: singlefile processing  (pre-cached HTML, no Playwright)");
const sfDir = await makeTempDir("singlefile");
const sfDb = openDb(sfDir);

// Pre-fetch outside the timed window so network latency isn't measured here
const prefetchCache = new FetchCache();
const { html, headers, status, statusText } = await prefetchCache.get(localUrl);

const snapshotId = createSnapshot(sfDb, localUrl);
const sfSnapshotDir = join(sfDir, "snapshots", String(snapshotId));
await mkdir(sfSnapshotDir, { recursive: true });

const t1 = performance.now();
await Promise.allSettled([
  htmlExtractor(sfDb, snapshotId, html),
  warcExtractor(sfDb, snapshotId, localUrl, headers, status, statusText, html, sfSnapshotDir),
  readabilityExtractor(sfDb, snapshotId, localUrl, html),
]);
const sfMs = performance.now() - t1;

sfDb.close();
await rm(sfDir, { recursive: true, force: true });
console.log(`  → ${fmt(sfMs)}`);

server.stop(true);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const speedup = addMs / sfMs;

console.log("\n=== CLI Add Benchmark Results ===");
console.log(`  webfrost add (full pipeline):        ${fmt(addMs)}`);
console.log(`  singlefile processing (no browser):  ${fmt(sfMs)}`);
console.log(`  speedup (singlefile vs full add):    ${speedup.toFixed(1)}×`);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const md = [
    "## WebFrost CLI Add Benchmark",
    "",
    "Compares two approaches to archiving a representative article page",
    "(equivalent to [yegor256.com/2017/03/28/solid.html](https://www.yegor256.com/2017/03/28/solid.html)):",
    "",
    "| Approach | Time | Extractors |",
    "|----------|------|------------|",
    `| \`webfrost add <url>\` (full pipeline) | **${fmt(addMs)}** | HTTP fetch + Playwright browser (PDF · screenshot · DOM · singlefile) + html + WARC + readability |`,
    `| Singlefile processing (no browser) | **${fmt(sfMs)}** | pre-cached HTML → html + WARC + readability only |`,
    "",
    `**Speedup:** singlefile processing is **${speedup.toFixed(1)}×** faster than the full add pipeline.`,
  ].join("\n");
  await appendFile(summaryPath, `${md}\n`);
  console.log("\n  Results written to GITHUB_STEP_SUMMARY.");
}
