# Benchmarks

Two kinds of benchmark live in this repository:

- **Microbenchmarks** (`bun run bench`), to catch regressions in hot code paths. They run in-process or
  against a loopback server, so they say nothing about how fast a real archive is.
- **A head-to-head harness against ArchiveBox** (`bench/vs-archivebox`), which archives the same pages in
  both tools under Docker and records wall time, CPU, memory and disk use.

## WebFrost vs ArchiveBox

**No published results yet.** The harness is ready; until it has been run and the numbers are in this
file, WebFrost makes no speed claims against ArchiveBox.

The design difference it is meant to measure: WebFrost fetches a page once and opens it in the browser
once, and every format is produced from those two visits. ArchiveBox runs each extractor separately.

```bash
mise run bench:vs-archivebox        # starts the services, runs every scenario, writes a chart, stops them
```

The Docker Compose file (`bench/vs-archivebox/docker-compose.yml`) runs WebFrost, built from this
repository, and ArchiveBox 0.7.3 side by side, with an nginx container serving three test pages (5 KB,
53 KB and 167 KB). Scenarios: one URL of each size, then batches of 10, 50 and 100 URLs. Results go to
`bench/vs-archivebox/results/latest.json` (not committed) and a Markdown table is printed to paste here,
with the machine it ran on.

## Microbenchmarks

Last recorded on an Apple M4 Pro with Bun 1.3.5 (2026-04-02). Compare runs on the same machine only.

| Benchmark | Script | avg / p50 |
|---|---|---|
| Write a WARC record for a 10 KB page | `packages/core/src/extractors/warc.bench.ts` | 51 µs |
| Readability on a 2,400-word article | `packages/core/src/extractors/readability.bench.ts` | 2.98 ms |
| SDK `listSnapshots()`, 50 items, loopback | `packages/sdk/src/client.bench.ts` | 0.077 ms |
| SDK `getSnapshot()`, loopback | `packages/sdk/src/client.bench.ts` | 0.057 ms |
| Web UI: snapshot list rendered after navigation, loopback | `bench/page-load.ts` | 14.7 ms |

```bash
bun run bench                                        # all of them
bun packages/core/src/extractors/warc.bench.ts       # one
bunx playwright install chromium && bun bench/page-load.ts   # needs a browser
```

A pull request that makes one of these more than 10% slower should say why in its description.
