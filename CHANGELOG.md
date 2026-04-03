# Changelog

All notable changes to WebFrost are documented here.

Format: [Versioning Strategy](docs/VERSIONING.md) · [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/)

---

## [Unreleased]

No unreleased changes. See [0.1.0] below.

---

## [0.1.0] — 2026-04-02

First public release. All packages stable enough for self-hosted use.

### Added

- `@webfrost/core` — SQLite-backed snapshot database (WAL mode), multi-extractor pipeline (WARC 1.1, Readability/JSDOM, PDF via Playwright, raw HTML, full-page screenshots, DOM snapshots, single-file HTML), shared HTTP cache (`FetchCache`) deduplicates requests across extractors within one snapshot, single Playwright browser navigation reused across all Playwright-dependent extractors
- `@webfrost/cli` — `webfrost init`, `webfrost add <url>`, `webfrost list`, `webfrost delete <id>`, `webfrost search <query>`, `webfrost search:rebuild`; `webfrost schedule` (add, list, remove, worker); `webfrost import` (plain text, OPML, Netscape bookmarks, RSS/Atom); `webfrost tag` (add, list, create, remove); `webfrost admin` (create user, key create/list/revoke)
- `@webfrost/server` — Elysia HTTP server with React UI bundled; REST API (`/api/auth`, `/api/snapshots`, `/api/schedules`, `/api/tags`, `/api/snapshots/:id/tags`); `/health` endpoint; CSP, `X-Frame-Options`, and `X-Content-Type-Options` security headers
- `@webfrost/sdk` — TypeScript client (`WebFrostClient`) for programmatic access: `listSnapshots()`, `getSnapshot()`, `addSnapshot()`, `downloadArchive()`, `searchSnapshots()`; optional `apiKey` for Bearer auth
- `@webfrost/ui` — React single-page app with snapshot list, detail view, client-side search/filter, pagination, extractor status indicators, and client-side routing
- **Auth** — API key (Bearer token) and session cookie authentication protecting all `/api/*` routes; `webfrost admin create` CLI command provisions an admin user and a default API key in one step; additional keys managed via `webfrost admin key create/list/revoke`; `SESSION_SECRET` env var signs cookies; `AUTH_DISABLED=true` development bypass
- **Full-text search** — SQLite FTS5 index over snapshot URLs and extracted content; `GET /api/snapshots?q=<term>` returns ranked results with HTML snippets highlighting matched terms; `webfrost search <query>` CLI command; `client.searchSnapshots()` SDK method; `webfrost search:rebuild` rebuilds the index from existing data
- **Tags** — full tag CRUD (`POST /api/tags`, `GET /api/tags`, `DELETE /api/tags/:id`) and snapshot-tag management (`GET/POST/DELETE /api/snapshots/:id/tags`); `webfrost tag` CLI subcommands
- **Snapshot deletion** — `DELETE /api/snapshots/:id` removes snapshot metadata and all associated archive files on disk; `webfrost delete <id>` CLI command
- **RSS/Atom import** — RSS and Atom feeds processed automatically by `webfrost import <feed-url>`
- Docker image published to GHCR (`ghcr.io/<org>/webfrost/server`) on semver tag push and `main` merge; multi-stage build (UI → server → slim Bun runtime)
- `docker-compose.prod.yml` — production Compose file with named volume, health check, and `IMAGE_TAG` override for pinned deploys
- GitHub Actions CI: lint (Biome), typecheck, `bun test`, Playwright E2E, benchmark artifacts uploaded on `main`
- Changeset-based versioning with `0.x` policy until board approves `1.x` (see [docs/VERSIONING.md](docs/VERSIONING.md))

### Security

- API key and session cookie authentication on all server routes (`AUTH_DISABLED=true` for dev only — never production)
- Passwords hashed with bcrypt (min cost 10) via `Bun.password`; API keys stored as SHA-256 hashes — raw key is shown once at creation and never stored
- Session tokens signed with HMAC-SHA256 using `SESSION_SECRET`; constant-time string comparison prevents timing attacks
- SSRF guard blocks private IP ranges and loopback addresses on all extractor HTTP fetches
- URL validation in `webfrost add` — rejects non-HTTP/HTTPS schemes before any network request
- Path traversal prevention in extractor file output
- CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy` headers on all server responses

### Performance

- `FetchCache`: one HTTP request per URL per snapshot regardless of extractor count
- Single `page.goto()` per snapshot shared across all Playwright-dependent extractors
- Benchmark results in [BENCHMARKS.md](BENCHMARKS.md): WARC extractor ~51 µs avg, Readability ~2.98 ms avg, SDK `listSnapshots` p50 0.077 ms, `getSnapshot` p50 0.057 ms, page load TTI proxy p50 14.7 ms (Apple M4 Pro, Bun 1.3.5)
