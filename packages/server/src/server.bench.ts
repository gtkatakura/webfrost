#!/usr/bin/env bun
/**
 * packages/server/src/server.bench.ts
 *
 * HTTP route latency benchmark for @webfrost/server.
 * Measures p50/p95/p99 for common API endpoints against a live in-process server.
 *
 * Run:
 *   AUTH_DISABLED=true bun run packages/server/src/server.bench.ts
 *   # or via the workspace script:
 *   bun run --filter '@webfrost/server' benchmarks
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set env vars before importing the app so the DB and auth config are correct.
process.env.AUTH_DISABLED = "true";
const dataDir = mkdtempSync(join(tmpdir(), "webfrost-bench-"));
process.env.WEBFROST_DIR = dataDir;

const { app } = await import("./index");

const BENCH_PORT = 19_001;
const BASE = `http://localhost:${BENCH_PORT}`;
const WARMUP = 30;
const ITERS = 300;

// Start the server on a fixed port.
app.listen(BENCH_PORT);
// Brief pause to let Elysia finish wiring routes.
await new Promise<void>((r) => setTimeout(r, 80));

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

function pct(sorted: number[], p: number): string {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return (sorted[Math.max(0, idx)] ?? 0).toFixed(2);
}

async function benchRoute(label: string, url: string): Promise<void> {
  // Warm-up: fill JIT caches and ensure any lazy init (DB open, etc.) is done.
  for (let i = 0; i < WARMUP; i++) {
    await fetch(url);
  }

  const times: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    await fetch(url);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  console.log(
    `  ${label.padEnd(28)} p50=${pct(times, 50)}ms  p95=${pct(times, 95)}ms  p99=${pct(times, 99)}ms` +
      `  min=${pct(times, 0)}ms  max=${times[times.length - 1]?.toFixed(2) ?? "—"}ms`,
  );
}

// ---------------------------------------------------------------------------
// Benchmark suite
// ---------------------------------------------------------------------------

console.log("\n@webfrost/server — route latency benchmark");
console.log("─".repeat(72));
console.log(`  Base: ${BASE}   iterations: ${ITERS}   warm-up: ${WARMUP}`);
console.log();

await benchRoute("GET /health", `${BASE}/health`);
await benchRoute("GET /api/v1/snapshots", `${BASE}/api/v1/snapshots`);
await benchRoute("GET /api/v1/stats", `${BASE}/api/v1/stats`);
await benchRoute("GET /api/v1/tags", `${BASE}/api/v1/tags`);
await benchRoute("GET /api/v1/schedules", `${BASE}/api/v1/schedules`);

console.log();

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

app.stop();
const { closeDatabases } = await import("@webfrost/core");
await closeDatabases();
rmSync(dataDir, { recursive: true, force: true });
