# Changelog

All notable changes to WebFrost are documented here.

Format: [Versioning Strategy](docs/VERSIONING.md) · [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/)

---

## [Unreleased]

Everything below is on `main` but has not shipped as a tagged release. The next release will be `0.1.0` via [changesets](docs/VERSIONING.md).

### Added

- `@webfrost/core` — SQLite-backed snapshot database (WAL mode), multi-extractor pipeline (WARC 1.1, Readability/JSDOM, PDF via Playwright, raw HTML), shared HTTP cache (`FetchCache`) deduplicates requests across extractors within one snapshot, single Playwright browser navigation reused across all Playwright-dependent extractors
- `@webfrost/cli` — `webfrost init`, `webfrost add <url>`, `webfrost list`; `webfrost schedule` (add, list, remove, worker) and `webfrost import` (plain text, OPML, Netscape bookmarks)
- `@webfrost/server` — Elysia HTTP server with React UI bundled; REST API (`/api/snapshots`, `/api/schedules`, `/api/tags`, `/api/snapshots/:id/tags`); `/health` endpoint; CSP, `X-Frame-Options`, and `X-Content-Type-Options` headers
- `@webfrost/sdk` — TypeScript client (`WebFrostClient`) for programmatic access: `listSnapshots()`, `getSnapshot()`, `addSnapshot()`, `downloadArchive()`
- `@webfrost/ui` — React single-page app with snapshot list, detail view, client-side search/filter, pagination, extractor status indicators, and client-side routing
- Tags — full tag CRUD (`POST /api/tags`, `GET /api/tags`, `DELETE /api/tags/:id`) and snapshot-tag management (`GET/POST/DELETE /api/snapshots/:id/tags`)
- Docker image published to GHCR (`ghcr.io/<org>/webfrost/server`) on semver tag and `main` push; multi-stage build (UI → server → slim runtime)
- `docker-compose.prod.yml` — production Compose file with named volume, health check, and `IMAGE_TAG` override
- GitHub Actions CI: lint (Biome), typecheck, test (`bun test`), Playwright E2E, benchmarks uploaded as artifact on `main`
- Changeset-based versioning with `0.x` policy until board approves `1.x` (see [docs/VERSIONING.md](docs/VERSIONING.md))

### Security

- SSRF guard blocking private IP ranges and loopback on all extractor HTTP fetches
- URL validation in CLI (`webfrost add`) — rejects non-HTTP/HTTPS schemes
- Path traversal prevention in extractor file output
- CSP headers on all server responses

### Performance

- `FetchCache`: one HTTP request per URL per snapshot, regardless of extractor count
- Single `page.goto()` per snapshot shared across all Playwright-dependent extractors
- Benchmark suite documented in [BENCHMARKS.md](BENCHMARKS.md): extractor throughput, SDK latency, page load, navigation overhead

---

## [0.3.0] — P3 UI milestone

### Added
- React UI with snapshot list, search/filter, detail view, client-side routing
- `@webfrost/sdk` TypeScript client
- Playwright E2E smoke test
- SDK latency and page-load benchmarks

---

## [0.2.0] — P2 server milestone

### Added
- Elysia HTTP server (`@webfrost/server`) with REST API
- WARC, Readability, and PDF extractors in `@webfrost/core`
- Multi-stage Docker build with React UI bundled into the server image
- GHCR deploy on `main` push

---

## [0.1.0] — P1 core milestone

### Added
- `@webfrost/core` — SQLite database, snapshot model, pipeline skeleton
- `@webfrost/cli` — `init`, `add`, `list` commands
- Benchmark baseline for core pipeline
