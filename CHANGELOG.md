# Changelog

Notable changes to WebFrost. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [SemVer](https://semver.org/), and while WebFrost is `0.x` a minor version can break the HTTP API,
the SDK or the on-disk layout (see [Releasing](apps/docs/content/docs/contributing/releasing.mdx)). Each
package also has its own changelog, generated from the changesets in [`.changeset`](.changeset).

## [Unreleased]: first public release (0.1.0)

Everything up to the first published version. The details are in the changesets in
[`.changeset`](.changeset), which become each package's changelog.

### Install and run

- A single `webfrost` binary for macOS and Linux (x64 and arm64), with the CLI, the server and
  the web UI inside. Installed with `curl -fsSL https://webfrost.dev/install.sh | sh`,
  `brew install gtkatakura/tap/webfrost`; the scripts
  verify the release checksum.
- `webfrost serve` runs the server, web UI and scheduler in one process and generates a session secret
  in the data directory when none is set; `webfrost setup` installs a headless Chromium only if none is
  found; `webfrost doctor` checks the data directory, database, Chromium, yt-dlp, ffmpeg and port.
- A Docker image for amd64 and arm64 with Chromium, yt-dlp and ffmpeg, running as a non-root user, and
  a production Compose file served at `https://webfrost.dev/compose.yml`
  (`curl -fsSLO https://webfrost.dev/compose.yml && docker compose up -d`), with an optional Litestream
  service for continuous SQLite backups.
- The CLI and the server share one archive, `~/.webfrost` by default (`WEBFROST_DIR`).

### Archiving

- Eight formats from one HTTP fetch and one browser navigation: WARC 1.1, raw HTML, readable text
  (Readability), PDF, full-page screenshot, DOM snapshot, self-contained HTML (SingleFile) and video or
  audio through yt-dlp. One extractor failing never fails the snapshot; each one records why it did not run.
- WARC records keep the body exactly as the server sent it, with digests, a record per redirect, and
  pass `warcio check`. Pages are decoded with their declared charset.
- Imports from plain URL lists, Netscape bookmarks, OPML and RSS/Atom feeds.
- Cron schedules for URLs and feeds (names, ranges with steps, `@daily`-style aliases, correct across
  DST changes), run by the server itself or by `webfrost schedule worker`.
- A job queue with a shared concurrency limit, leases that survive crashes and restarts, fenced writes,
  timeouts that really cancel the work, and a minimum gap between two archives of the same site
  (`WEBFROST_DOMAIN_DELAY_MS`).

### Data

- Metadata in SQLite by default, or in PostgreSQL 13+ or MySQL 8.0.13+ through `DATABASE_URL`, with the
  schema created and migrated automatically.
- Full-text search on every engine (FTS5, `tsvector`, `FULLTEXT`) over URLs, titles, extracted text and
  tag names, with highlighted snippets.
- Archive files on the local filesystem or in S3-compatible storage (S3, MinIO, R2, B2), streamed
  without loading them into memory.

### Surfaces

- `webfrost` CLI: `serve`, `setup`, `doctor`, `add`, `list`, `search`, `import`, `delete`, `schedule`,
  `tag`, `admin`, `init`, `search:rebuild`, with `--help` on every command, `--json` output where it
  makes sense, and exit codes scripts can rely on.
- HTTP API v1 under `/api/v1`: one error shape (`{ error, code }`), one list envelope
  (`{ items, total, page, limit }`), ISO 8601 timestamps, no storage paths in responses. The unversioned
  `/api` is a deprecated alias that answers with `Deprecation` and `Link` headers.
- A TypeScript SDK, `@webfrost/sdk`, ready in the repository and published to npm after this release.
- Web UI in the WebFrost "Ice Blue" look, light and dark: dashboard, a snapshot list with a detail panel
  (`/#/snapshots/:id`) and sandboxed previews, search with highlights and saved searches, tags,
  schedules, imports, API keys, a command palette and keyboard shortcuts, clear error states,
  accessible dialogs and a phone layout.
- Agent skills (`npx skills add gtkatakura/webfrost`) for using and self-hosting WebFrost.
- Documentation at [webfrost.dev](https://webfrost.dev).

### Observability

- Optional OpenTelemetry export of traces, metrics and logs over OTLP/HTTP to your own collector. Off
  unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; only hosts of archived pages are recorded by default.
  WebFrost collects no telemetry of its own.

### Security

- API keys (stored hashed, optional expiry) and server-side sessions, revoked on logout and on password
  change.
- CSRF protection for cookie-authenticated requests, JSON-only bodies, and a setup token
  (`WEBFROST_SETUP_TOKEN`) so nobody else can claim a fresh instance.
- Login and API rate limits; `X-Forwarded-For` trusted only with `WEBFROST_TRUST_PROXY`, read from the
  right (`WEBFROST_TRUSTED_PROXY_HOPS`).
- Read-only public mode (`WEBFROST_PUBLIC_READ`): visitors browse and search, only signed-in users change
  anything.
- SSRF guard on every fetch, every redirect hop and every request the headless browser makes.
- yt-dlp runs without config files, playlists or the generic extractor, in its own process group.
- Archived pages are previewed in a sandbox (CSP `sandbox`, no scripts, opaque origin); S3 downloads
  are forced to download, never render.
- Request size limits, list pages capped at 200, and graceful shutdown that lets running archives finish.

### Fixed

- Bun upgraded to 1.4.4: Bun 1.3 closed already-closed file descriptors of child processes, which could
  close the archive database's files after the browser exited (`SQLITE_IOERR`).
