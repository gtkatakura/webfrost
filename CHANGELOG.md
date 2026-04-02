# Changelog

All notable changes to WebFrost are documented here.

Format: [Versioning Strategy](docs/VERSIONING.md) · [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/)

---

## [Unreleased]

Changes in progress on `main` that have not shipped as a tagged release.

---

## [1.0.0] — TBD

First production release. Covers P1 through P4.

### Added

- `@webfrost/core` — SQLite-backed snapshot database, multi-extractor pipeline (WARC, Readability, PDF), shared HTTP cache across extractors per snapshot, single Playwright browser navigation reused across all Playwright-dependent extractors
- `@webfrost/cli` — `webfrost init`, `webfrost add <url>`, `webfrost list`; `webfrost schedule` and `webfrost import` (P4)
- `@webfrost/server` — Elysia HTTP server with React UI; REST API (`/api/snapshots`, `/api/snapshots/:id`, `/api/snapshots/:id/archives/:extractor/download`); `/health` endpoint
- `@webfrost/sdk` — TypeScript client (`WebFrostClient`) for programmatic access
- `@webfrost/ui` — React single-page app with snapshot list, detail view, search/filter, and client-side routing
- Docker image published to GHCR (`ghcr.io/<org>/webfrost/server`) on tag and `main` push
- GitHub Actions CI: lint, typecheck, test, Playwright E2E, benchmarks
- Benchmark baseline in `bench/BASELINE.md`

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
