/**
 * SDK call latency benchmark — p50/p95/p99
 *
 * Spins up a Bun.serve() mock server that returns realistic snapshot payloads,
 * then measures round-trip latency of listSnapshots() and getSnapshot() over
 * 200 iterations (after 20 warm-up rounds).
 *
 * Run: bun src/client.bench.ts
 */
import { WebFrostClient } from "./client";

const ITERATIONS = 200;
const WARM_UP = 20;
const SNAPSHOT_COUNT = 50;

// ---------------------------------------------------------------------------
// Mock server payloads
// ---------------------------------------------------------------------------
const snapshots = Array.from({ length: SNAPSHOT_COUNT }, (_, i) => ({
  id: i + 1,
  url: `https://example.com/page-${i + 1}`,
  status: "done",
  createdAt: "2026-04-01T00:00:00.000Z",
}));

const detail = {
  id: 1,
  url: "https://example.com/page-1",
  status: "done",
  createdAt: "2026-04-01T00:00:00.000Z",
  archiveResults: [
    {
      id: 1,
      extractor: "warc",
      content: "<html><body>archived</body></html>",
      created_at: "2026-04-01T00:00:00.000Z",
    },
    {
      id: 2,
      extractor: "readability",
      content: "archived text",
      created_at: "2026-04-01T00:00:00.000Z",
    },
  ],
};

const snapshotsBody = JSON.stringify(snapshots);
const detailBody = JSON.stringify(detail);

// ---------------------------------------------------------------------------
// Mock server
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: 0, // random available port
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/snapshots") {
      return new Response(snapshotsBody, {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (/^\/snapshots\/\d+$/.test(pathname)) {
      return new Response(detailBody, {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const client = new WebFrostClient({ baseUrl: `http://localhost:${server.port}` });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measureLatencies(
  label: string,
  fn: () => Promise<unknown>,
  warmUp: number,
  iterations: number,
): Promise<void> {
  // Warm up
  for (let i = 0; i < warmUp; i++) {
    await fn();
  }

  // Collect samples
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const min = samples[0] ?? 0;
  const max = samples[samples.length - 1] ?? 0;

  console.log(`\n=== ${label} (n=${iterations}, mock server) ===`);
  console.log(`  p50: ${p50.toFixed(3)} ms`);
  console.log(`  p95: ${p95.toFixed(3)} ms`);
  console.log(`  p99: ${p99.toFixed(3)} ms`);
  console.log(`  min: ${min.toFixed(3)} ms  max: ${max.toFixed(3)} ms`);
}

// ---------------------------------------------------------------------------
// Run benchmarks
// ---------------------------------------------------------------------------
console.log("WebFrost SDK call latency benchmark");
console.log(`Server: http://localhost:${server.port}`);
console.log(`Payload: ${SNAPSHOT_COUNT} snapshots`);

await measureLatencies("listSnapshots()", () => client.listSnapshots(), WARM_UP, ITERATIONS);

await measureLatencies(
  "getSnapshot(1)",
  () => client.getSnapshot(1).then(() => undefined),
  WARM_UP,
  ITERATIONS,
);

server.stop();
