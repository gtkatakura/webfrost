# Benchmarks — WebFrost

Performance benchmark results for the WebFrost toolkit. Run the full suite with `bun run bench`.

---

## Hardware & Environment

| Property | Value |
|----------|-------|
| CPU | Apple M4 Pro |
| Clock | ~4.34 GHz |
| Runtime | Bun 1.3.5 (arm64-darwin) |
| OS | macOS (Darwin 24.x) |
| Date | 2026-04-02 |

All benchmarks run in-process or against a local loopback server. No external network traffic — numbers reflect compute and I/O overhead on the test machine. Real-world results will be higher due to network latency, DNS resolution, and remote server response times.

---

## Extractor Throughput

**Scripts:** `packages/core/src/extractors/warc.bench.ts`, `packages/core/src/extractors/readability.bench.ts`

**Method:** mitata benchmark runner, multiple iterations. Synthetic 10 KB HTML page for WARC; a ~2,400-word article fragment for Readability.

| Extractor | avg | p75 | min | max |
|-----------|-----|-----|-----|-----|
| WARC: build + write 10 KB page | 51.37 µs | 48.29 µs | 37.21 µs | 2.14 ms |
| Readability: parse news article | 2.98 ms | 3.18 ms | 2.15 ms | 7.59 ms |

**Notes:**
- WARC extractor writes a WARC/1.1 record to a temp directory; disk I/O is included in the measurement.
- Readability runs JSDOM + Mozilla Readability; GC pressure causes occasional tail latency spikes (max 7.59 ms).
- Production performance scales with page complexity, DOM depth, and disk speed.

---

## SDK Call Latency

**Script:** `packages/sdk/src/client.bench.ts`

**Method:** 200 iterations after 20 warm-up rounds. In-process `Bun.serve()` loopback server returns 50 snapshot objects. Measures `fetch()` round-trip + JSON parse overhead.

| Method | p50 | p95 | p99 | min | max |
|--------|-----|-----|-----|-----|-----|
| `listSnapshots()` | 0.077 ms | 0.122 ms | 0.206 ms | 0.056 ms | 0.574 ms |
| `getSnapshot(id)` | 0.057 ms | 0.068 ms | 0.088 ms | 0.049 ms | 0.159 ms |

**Notes:**
- Loopback removes real network and server processing time — these numbers reflect pure Bun `fetch()` + JSON parse.
- `listSnapshots` p99 is slightly higher because the response body is ~50× larger (50-item array vs one object).
- Against a running `@webfrost/server`, expect 1–3 ms added per call for SQLite read + Elysia routing on a warm DB.

---

## Page Load (React UI)

**Script:** `bench/page-load.ts`

**Method:** 10 Playwright Chromium headless navigations against a loopback server serving 50 snapshots. Two metrics:

- **Page load** — `window.performance.timing.loadEventEnd − navigationStart` (browser-side)
- **TTI proxy** — wall-clock from `page.goto()` call until snapshot list is rendered and `window.__loaded === true`

| Metric | p50 | p95 | p99 | min | max |
|--------|-----|-----|-----|-----|-----|
| Page load | 3.0 ms | 15.0 ms | 15.0 ms | 3.0 ms | 15.0 ms |
| TTI proxy | 14.7 ms | 38.0 ms | 38.0 ms | 10.2 ms | 38.0 ms |

**Notes:**
- Loopback server; real-world numbers will be higher.
- The full Vite-built React app adds ~10–50 ms cold JS parse/execute time on top of these numbers.
- TTI proxy measures the additional time for `fetch('/api/snapshots')` + DOM rendering beyond the base page load.

---

## Shared HTTP Cache (FetchCache)

**Script:** `bench/fetch-cache.bench.ts`

**Method:** mitata benchmark. Compares 3 sequential `fetch()` calls to the same URL against 3 `FetchCache.get()` calls.

| Scenario | avg | p75 | min | max |
|----------|-----|-----|-----|-----|
| Baseline: 3× raw `fetch()` for same URL | 105.60 µs | 106.67 µs | 76.67 µs | 376.54 µs |
| Optimized: 3× `FetchCache.get()` (1 real request) | *see note* | — | — | — |

> **Note:** The optimized variant is suppressed in this environment because the SSRF guard (introduced in the security hardening pass) correctly blocks `localhost` resolving to private IPv6 `::1`. In production, WebFrost fetches external URLs, so the SSRF guard does not apply.
>
> **Architecture impact:** In production, `FetchCache` deduplicates HTTP requests across all extractors within one snapshot. For a page with 3 Playwright-dependent extractors (WARC, PDF, Readability), this eliminates 2 of 3 HTTP fetches — reducing network overhead to ⅓ of the naïve implementation.

---

## Browser Navigation (Playwright)

**Script:** `bench/playwright-navigation.bench.ts`

**Method:** mitata benchmark with mock Playwright pages (no real browser). Demonstrates the pipeline's shared-page architecture: one `page.goto()` serves all extractors.

| Scenario | avg | p75 | min | max |
|----------|-----|-----|-----|-----|
| Baseline: 3 extractors × 1 goto each (old design) | 321.13 ns | 323.47 ns | 283.19 ns | 633.43 ns |
| Optimized: shared page, 1 goto for all extractors | 233.52 ns | 236.38 ns | 207.54 ns | 325.29 ns |

**Notes:**
- Both scenarios use mock pages — dispatch overhead only, no real Chromium launch.
- In production, a real `page.goto()` costs 200–2,000 ms depending on page complexity. Reducing from 3 navigations to 1 saves **400–4,000 ms per snapshot** for a 3-extractor pipeline (PDF, screenshot, DOM).
- The 27% dispatch speedup (321 ns → 234 ns) is a secondary effect; the primary gain is the eliminated network round-trips.

---

## WebFrost vs ArchiveBox — Head-to-Head Comparison

**Status:** Harness implemented; results pending first Docker run.

**Script:** `bench/vs-archivebox/run.ts`

**Method:** Docker Compose environment (`bench/vs-archivebox/docker-compose.yml`) runs WebFrost
(built from local Dockerfile) and ArchiveBox 0.7.3 side-by-side. A fixture nginx server
serves three static HTML test pages at known sizes. The runner submits URLs to each system
and waits for completion, measuring wall time, peak CPU/memory (via `docker stats`), and
disk growth (via `du -sk /data`).

**Test pages:**

| Page | Size | Description |
|------|------|-------------|
| small.html | ~5 KB | Static blog post, minimal JS |
| medium.html | ~53 KB | News-style article, rich text |
| large.html | ~167 KB | Heavy page with inline CSS/JS |

**Scenarios:** single URL (small, medium, large), batch 10, batch 50, batch 100 URLs.

**Running the harness:**

```bash
# Start the Docker environment (first time builds WebFrost image — may take a few minutes)
docker compose -f bench/vs-archivebox/docker-compose.yml up -d --wait

# Run all scenarios (WebFrost + ArchiveBox)
bun bench/vs-archivebox/run.ts

# WebFrost only (no Docker required for ArchiveBox)
bun bench/vs-archivebox/run.ts --skip-archivebox

# Custom endpoints
bun bench/vs-archivebox/run.ts \
  --webfrost-url http://localhost:18081 \
  --archivebox-url http://localhost:18082 \
  --fixture-url http://localhost:18080 \
  --output bench/vs-archivebox/results/$(date +%Y%m%d).json

# Tear down
docker compose -f bench/vs-archivebox/docker-compose.yml down -v
```

Results are written to `bench/vs-archivebox/results/latest.json` (gitignored) and a
human-readable BENCHMARKS.md section is printed to stdout for copy-paste into this file.

---

## Regression Policy

- Any PR that regresses a metric by more than **10%** should include an explanation in the PR description.
- `bun run bench` runs on every push to `main` via CI (artifacts retained 90 days under `bench-results-<sha>`).
- Benchmarks run on PRs with `continue-on-error: true` — failures are visible but do not block merge.

---

## Re-running

```bash
# Full suite
bun run bench

# Individual scripts
bun packages/core/src/extractors/warc.bench.ts
bun packages/core/src/extractors/readability.bench.ts
bun packages/sdk/src/client.bench.ts

# Page load (requires Chromium)
bunx playwright install chromium   # first time only
bun bench/page-load.ts

# FetchCache and navigation dispatch
bun bench/fetch-cache.bench.ts
bun bench/playwright-navigation.bench.ts
```
