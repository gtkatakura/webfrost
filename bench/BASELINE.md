# P1 Benchmark Baseline

Captured: 2026-04-02
Pipeline: P1 (commit `da4d1b0`)
Runtime: Bun (see `mise.toml` for the pinned version)

## Status

P1 ships no `.bench.ts` files. Running `bun run bench` exits cleanly but produces no measurements — the `@webfrost/core` bench script globs `src/**/*.bench.ts` and finds nothing.

This document records the P1 **operational baseline**: what the pipeline does, the expected cost of each operation, and how to add benchmarks in P2+.

## P1 Operations

| Operation | Location | Description |
|-----------|----------|-------------|
| `openDb(dir)` | `packages/core/src/db.ts` | Opens (or creates) `archive.db` in `dir`. Enables WAL mode. Creates three tables if absent: `snapshots`, `archive_results`, `job_queue`. |
| `addUrl(db, url)` | `packages/core/src/pipeline.ts` | Inserts a snapshot row, enqueues it, fetches the URL over HTTP, stores raw HTML in `archive_results`, and marks the snapshot `done`. On network or HTTP error, marks both rows `failed`. |
| `listSnapshots(db)` | `packages/core/src/list.ts` | Reads all rows from `snapshots` and returns them. |

## Expected Cost Profile (P1)

These are design-level estimates, not measured numbers. Use them as sanity bounds when real benchmarks land.

- **`openDb`** — microseconds. One `Database()` constructor call, one `PRAGMA`, three `CREATE TABLE IF NOT EXISTS` statements. Dominated by filesystem open.
- **`addUrl` (local/fast host)** — milliseconds to low tens of milliseconds. Dominated by the outbound HTTP fetch. SQLite writes are synchronous and cheap (WAL mode, in-process).
- **`addUrl` (real-world URL)** — hundreds of milliseconds to seconds, depending on network latency and page size.
- **`listSnapshots`** — sub-millisecond for typical archive sizes. Single `SELECT *` with no joins.

## How to Add Benchmarks

Bun's built-in benchmark runner is already wired up. To add a benchmark:

1. Create `packages/core/src/<name>.bench.ts`.
2. Use `Bun.bench` (or the `bench` helper from `bun:test`):

```ts
import { bench, run } from "bun:test";
import { openDb } from "./db";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const dir = mkdtempSync(`${tmpdir()}/webfrost-bench-`);
const db = openDb(dir);

bench("openDb", () => {
  openDb(mkdtempSync(`${tmpdir()}/webfrost-bench-`));
});

await run();
```

3. Run `bun run bench` from the repo root. Results print to stdout.
4. Update this file with the measured numbers and the Bun version used.

## Running the Bench Suite

```bash
bun run bench
```

No arguments needed. The workspace script fans out to all packages. Only `@webfrost/core` has a real bench script; `@webfrost/cli` and `@webfrost/server` echo a no-op.

## Regression Policy

Once benchmark files exist, any P2+ PR that regresses a metric by more than **10%** should include a note in the PR description explaining the trade-off. There is no automated gate yet — this is a manual check until CI benchmarking is set up.
