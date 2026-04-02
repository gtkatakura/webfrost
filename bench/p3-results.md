# P3 Benchmark Results

Captured: 2026-04-02
Pipeline: P3 (React UI + SDK)
Runtime: Bun v1.3.5 (macOS arm64, Apple Silicon)

---

## SDK Call Latency

**Script:** `packages/sdk/src/client.bench.ts`
**Method:** 200 iterations after 20 warm-up rounds. Mock `Bun.serve()` server returns 50
snapshot objects. Measures Bun fetch round-trip latency (in-process loopback).

| Method | p50 | p95 | p99 | min | max |
|---|---|---|---|---|---|
| `listSnapshots()` | 0.068 ms | 0.100 ms | 0.371 ms | 0.058 ms | 0.539 ms |
| `getSnapshot(id)` | 0.058 ms | 0.066 ms | 0.071 ms | 0.050 ms | 0.109 ms |

**Notes:**
- Loopback server removes real network and server processing time — these numbers reflect
  pure Bun `fetch()` + JSON parse overhead.
- `listSnapshots` p99 spikes slightly vs `getSnapshot` because its response body is ~50×
  larger (50-item array vs single object).
- Against a real running `@webfrost/server`, expect an additional 1–3 ms per call for
  SQLite read + Elysia routing on a warm DB.

---

## Page Load Time (Playwright)

**Script:** `bench/page-load.ts`
**Method:** 10 Playwright Chromium headless navigations. Serves an inline HTML page with
a JS fetch to `/api/snapshots` (50 items). Measures:

- **Page load** — `window.performance.timing.loadEventEnd − navigationStart` (browser-side)
- **TTI proxy** — wall-clock time from `page.goto()` call until snapshot list is rendered
  and `window.__loaded === true`

| Metric | p50 | p95 | p99 | min | max |
|---|---|---|---|---|---|
| Page load | 4.0 ms | 7.0 ms | 7.0 ms | 3.0 ms | 7.0 ms |
| TTI proxy | 11.2 ms | 19.5 ms | 19.5 ms | 10.3 ms | 19.5 ms |

**Notes:**
- Loopback server; figures do not include real network latency.
- TTI proxy measures the additional time for `fetch('/api/snapshots')` + DOM rendering
  on top of the base page load.
- The full React app (Vite build) will add JS parse/execute time (~10–50 ms cold) on top
  of these numbers.

---

## Regression Policy

From `bench/BASELINE.md` (unchanged for P3):

- Any PR that regresses a measured metric by more than **10%** should include an
  explanation in the PR description.
- Benchmarks run on every push to `main` (CI artifacts retained 90 days) and optionally
  on PRs (continue-on-error).

---

## How to Re-run

```bash
# SDK latency
bun packages/sdk/src/client.bench.ts

# Page load (requires Chromium)
bunx playwright install chromium   # first time only
bun bench/page-load.ts

# Both via workspace script
bun run bench
```
