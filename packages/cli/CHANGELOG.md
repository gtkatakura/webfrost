# @webfrost/cli

## 0.3.0

### Minor Changes

- 3fc46a1: Archive on your machine, keep it on the server. `webfrost push <id...> --to <url>` sends finished snapshots to a WebFrost server, which stores each one as a new snapshot with the same files, results, status, capture time and tags, without fetching anything again: useful when the server cannot archive a page itself (video sites often refuse server addresses) or to archive on a laptop and keep everything in one place. The API key comes from `WEBFROST_API_KEY`, never from a flag.
  
  Snapshots travel as snapshot bundles, one ZIP file with a `manifest.json` and the snapshot's files: `webfrost export <id> -o file.zip` writes one, `webfrost import file.zip` stores one in a local archive, the new `POST /api/v1/snapshots/import` route (`application/zip` body, `201 { id, url, status }`) and the SDK's `importSnapshot()` upload one. The server checks bundles strictly (manifest schema, known extractors, fixed file names, no unreferenced entries, size limits before and while decompressing) and accepts up to `WEBFROST_IMPORT_BUNDLE_MAX_BYTES` (default 2 GiB). Other routes now refuse a chunked request body without `Content-Length` (`411`).

### Patch Changes

- 82bc9b8: Each release also ships a `.deb` (Debian, Ubuntu) and an `.rpm` (Fedora) for x64 and arm64. They install `webfrost` in `/usr/bin` and bring, as dependencies, every system library the browser needs, so `webfrost setup` works without installing anything else; `yt-dlp` and `ffmpeg` are recommended.
- Updated dependencies [ed767b6]
- Updated dependencies [3fc46a1]
  - @webfrost/core@0.3.0
  - @webfrost/server@0.3.0

## 0.2.0

### Patch Changes

- 9e70e13: The `webfrost` binary archives screenshots, PDFs and SingleFile again. Built into a single file, it looked for the browser library's own files at the path of the machine that built it, so on any other machine the browser never started and only HTML, WARC and readable text were saved. `webfrost setup` and `webfrost doctor` now open a blank page to check that the browser really works (a browser can answer `--version` and still lack the libraries a page needs), and when a system library is missing they print the command that installs them with your package manager: `apt-get` (with the names Debian and Ubuntu use), `dnf` or `pacman`.
- Updated dependencies [66ff385]
- Updated dependencies [4ab82e0]
- Updated dependencies [07c0901]
- Updated dependencies [037d94f]
- Updated dependencies [07c0901]
- Updated dependencies [66ff385]
  - @webfrost/server@0.2.0
  - @webfrost/core@0.2.0

## 0.1.0

### Minor Changes

- ae07bb9: Reliability and security hardening pass.
  
  **Fixed**
  
  - Imports through the server (`POST /api/import`, `/api/import/file`, the Import page) never archived anything: every imported snapshot stayed `pending`. Background pipelines now get their own database connection.
  - Schedules created in the web UI never ran, because only `webfrost schedule worker` polled them. The server now runs due schedules itself (`WEBFROST_SCHEDULER=false` turns that off).
  - The Docker image had no Chromium and no yt-dlp, so PDF, screenshot, DOM snapshot, SingleFile and media extraction were silently skipped. It now bundles Chromium, yt-dlp and ffmpeg. `docker-compose.prod.yml` passes `SESSION_SECRET` (the server refused to start without it).
  - Snapshots left `pending` by a crash or restart are re-queued (at startup and every minute; a job another process is still running is left alone).
  - A pipeline could wait up to 30 minutes on a yt-dlp or Chromium process that had already exited. Subprocess output collection and browser shutdown are now bounded.
  - The Media tab could not play archived media (blocked by the Content-Security-Policy) or show its metadata; with the S3 backend screenshots did not display either.
  - A snapshot with no successful extractor is `failed` instead of `done`. Browser extractors that could not run are recorded as failed with the reason instead of being dropped.
  - Tags added after archiving are now searchable.
  - The archived-page preview (DOM tab) was blocked by the server's own CSP and never rendered. It is now served by a dedicated sandboxed endpoint (`GET /api/snapshots/:id/archives/:extractor/preview`).
  - The Reader tab showed no article text; search results had no pagination; lists did not refresh while a snapshot was pending; bulk actions hid partial failures; an expired session left the UI showing raw errors.
  
  **Security**
  
  - The SSRF guard now covers the headless browser (every request a page makes), not just the first fetch, plus more reserved ranges and IPv4-mapped / NAT64 addresses.
  - Sessions are stored server-side: logout and password changes revoke them. Existing sessions are invalidated by this upgrade — sign in again.
  - Login, password change and setup are limited to 10 attempts per minute per client.
  - Rate limits use the socket address; `X-Forwarded-For` is honoured only with `WEBFROST_TRUST_PROXY=true`.
  - Search snippets are HTML-escaped on the server and rendered as text in the UI.
  - First-run setup can no longer be raced into creating two admins; API keys with an ISO-format expiry now expire on time.
  - The preview iframe no longer asks for `allow-scripts allow-same-origin`.
  
  **Added**
  
  - Public read / private write: `WEBFROST_PUBLIC_READ=true` lets anonymous visitors browse, search and download; every change still requires signing in. The web UI gains a read-only guest view.
  - Snapshot lists are returned newest first, so the dashboard's recent activity and the first page of the list show what was just archived (they showed the oldest snapshots).
  
  - Per-domain rate limiting (`WEBFROST_DOMAIN_DELAY_MS`, default 1 s between archives of one host).
  - Timeouts: page fetch (`WEBFROST_FETCH_TIMEOUT_MS`), extractors (`WEBFROST_EXTRACTOR_TIMEOUT_MS`), yt-dlp (`WEBFROST_MEDIA_TIMEOUT_MS`).
  - `WEBFROST_CHROMIUM_PATH` to use a system Chromium; `WEBFROST_INSECURE_COOKIES` for HTTP-only LAN deployments.
  - `POST /api/snapshots` shares `WEBFROST_CONCURRENCY` with imports and schedules instead of launching one browser per request.
  - Search hits and the snapshot detail include `status`, `title`, `extractors`, `tags`; SDK gains `searchSnapshotsPage()` and `WebFrostError.retryAfter`.
  - SQLite: `busy_timeout`, indexes on the hot queries, schema applied once per archive instead of on every connection.
  
  **Changed (may need action)**
  
  - `POST /api/auth/change-password` answers a wrong current password with `403` (was `401`).
  - `POST /api/setup` and `webfrost admin create` require a password of at least 8 characters.
  - Behind a reverse proxy, set `WEBFROST_TRUST_PROXY=true` or all clients share one rate-limit bucket.
  - The server reads `WEBFROST_LOG_LEVEL` (the old `LOG_LEVEL` still works).
- 20bfc56: Optional OpenTelemetry export, off by default. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or a per-signal endpoint) and the server, `webfrost serve`, the CLI, the Docker image and the binary send traces and metrics over OTLP/HTTP to your own collector; `OTEL_LOGS_EXPORTER=otlp` adds the log lines. The standard `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER(_ARG)` and `OTEL_SDK_DISABLED` variables apply. Without an endpoint the OpenTelemetry SDK is not loaded at all.
  
  - Traces: a server span per request named after its route, a span per archive run (parented to the request or schedule tick that queued it) with spans for the page fetch, the browser navigation, each extractor, yt-dlp and the database statements, and spans for the recovery sweep and scheduler ticks.
  - Metrics: snapshots finished by status, extractor duration by format and outcome, bytes archived, the job queue, retries and recovered leases, per-host throttle waits, HTTP request duration and database operation duration.
  - Server log lines carry `trace_id` and `span_id` while a span is active.
  - Only hosts are recorded for archived pages (full URLs with `WEBFROST_OTEL_FULL_URLS=true`); never query strings, headers, bodies or SQL parameters.
  - Buffered data is flushed on graceful shutdown, for at most 5 seconds.
  
  See the new [Observability](https://webfrost.dev/docs/guides/observability) guide.
- 3afc954: PostgreSQL and MySQL support, next to SQLite.
  
  **Added**
  
  - `DATABASE_URL` selects the metadata database: `postgres://…` (PostgreSQL 13+), `mysql://…` (MySQL 8.0.13+) or `sqlite://…` / a file path. Without it nothing changes: SQLite at `$WEBFROST_DIR/archive.db`. Archive files stay on the configured storage backend (filesystem or S3) whichever database is used. The schema is created and migrated automatically on first start.
  - Full-text search on every engine: SQLite keeps FTS5; PostgreSQL uses a `tsvector` column with a GIN index, MySQL a `FULLTEXT` index. Both index URL, title, text and tags with the same tokenisation as FTS5, accept the common query syntax (words, `"phrases"`, `prefix*`, `OR`, `NOT`/`-word`) and return snippets with the same HTML-escaped `<mark>` contract. `rank` is lower-is-better everywhere.
  - Connection pools for PostgreSQL/MySQL (`WEBFROST_DB_POOL_MAX`, `WEBFROST_DB_POOL_IDLE_MS`), closed on graceful shutdown.
  - Optional Litestream service in `docker-compose.prod.yml` (`--profile backup`) that streams `archive.db` to S3-compatible storage, and a new Backups guide (plain files, Litestream, `pg_dump`, `mysqldump`).
  
  **Fixed**
  
  - Lease fencing for archive jobs: a worker that was presumed dead and adopted by another process can no longer overwrite the new run's status or add results to it. Each job carries a lease token that every pipeline write is conditional on.
  - Deleting a snapshot and rebuilding or updating the search index now run in transactions.
  - The stats endpoint no longer asks the storage backend for the size of every artifact on each call: sizes are stored when results are written (`archive_results.size_bytes`); results from older archives are measured once and stored.
  
  **Changed (may need action)**
  
  - `@webfrost/core`'s database API is asynchronous: `openDb()` returns a promise of a `Db` handle (`await db.close()`), and every function that reads or writes the database returns a promise. `JobRunner.add()` and `JobRunner.recoverPending()` are async; `createSnapshotJob()` returns the snapshot id with its lease token.
  - Existing SQLite archives are upgraded in place to schema version 3 on first open (two new columns, no data rewritten except a size backfill). Take a backup before upgrading if you may want to roll back.
- 45bb4ba: WebFrost ships as a single `webfrost` binary for macOS and Linux (x64 and arm64), installed with `curl -fsSL https://webfrost.dev/install.sh | sh`, `irm https://webfrost.dev/install.ps1 | iex` or `brew install gtkatakura/tap/webfrost`.
  
  New commands: `webfrost serve` (server, web UI and scheduler in one process; generates and stores a `SESSION_SECRET` in the data directory when none is set), `webfrost setup` (installs a headless Chromium into WebFrost's cache directory) and `webfrost doctor` (checks Chromium, yt-dlp, ffmpeg, the data directory and the port; exits 1 when something required is missing).
  
  CLI changes:
  
  - Flags are parsed per command with `util.parseArgs`: `--flag value` and `--flag=value` both work, and unknown flags are errors. `webfrost help [command]` and `<command> --help` describe every command.
  - Exit codes: `add` exits 1 unless the snapshot ends `done`, `import` exits 1 if any URL failed, usage errors (including no command at all) exit 2. Errors print as one `Error: <message>` line; stack traces only with `--verbose`.
  - `list` gets `--status`, `--limit`, `--page` and `--json` (and lists newest first); `search` gets `--limit`, `--page` and `--json`; `add` gets `--json`.
  - `admin create` reads the password from `--password-stdin`, `WEBFROST_PASSWORD` or a hidden prompt; `--password` still works but warns that it leaks into shell history. `--expires` must be an ISO 8601 date in the future.
  - The CLI's default data directory is now `~/.webfrost`, like the server's, instead of the current directory, so `webfrost add` and `webfrost serve` share an archive. Set `WEBFROST_DIR` to keep using another directory.
  
  Core: the browser lookup moved into `@webfrost/core` and is used by the pipeline everywhere: `WEBFROST_CHROMIUM_PATH`, then the Chromium `webfrost setup` installed (`WEBFROST_CACHE_DIR`), then a system Chrome or Chromium, then Playwright's own. `@webfrost/server` exports `startServer()`, and no longer exits at import time when `SESSION_SECRET` is missing.

### Patch Changes

- 8033935: Archive fidelity, real cancellation and yt-dlp hardening.
  
  **Fixed**
  
  - WARC files were invalid for compressed, binary and non-UTF-8 responses: the body was the runtime's decoded text while the headers still said `Content-Encoding: gzip` and the original `Content-Length`. The response record now holds the body exactly as the server sent it (still compressed, bytes untouched), `Transfer-Encoding` is dropped and `Content-Length` matches the stored body. Records carry `WARC-Block-Digest` / `WARC-Payload-Digest` and pass `warcio check`.
  - The WARC targets the final URL after redirects; each redirect gets its own `response` record and a `metadata` record keeps the URL that was requested.
  - HTML and Readability decode the page with its declared charset (`Content-Type`, then `<meta charset>`), so latin1 and other non-UTF-8 pages are no longer mojibake. Readability resolves links against the final URL. A URL that is not text (PDF, image) no longer produces garbage `html` / `readability` results.
  - Timeouts now cancel the work: a timed-out extractor's downloads are aborted, and yt-dlp runs in its own process group that is killed as a whole (no orphaned ffmpeg). Nothing is recorded after a timeout.
  - SingleFile: CSS containing `$'` or `$&` was corrupted and only the first of repeated tags was inlined.
  - Bulk import: `&amp;` and other entities in feed, OPML and bookmark URLs are decoded; relative Atom links are resolved against the feed URL (or `xml:base`, or the feed's `rel="self"` link).
  
  **Security**
  
  - yt-dlp is called with `--ignore-config`, `--no-playlist --playlist-items 1`, `--use-extractors default,-generic` and `--` before the URL. The separate `--simulate` probe is gone (one `--dump-json` call).
  
  **Added**
  
  - `WEBFROST_SINGLEFILE_MAX_BYTES` (100 MB) and `WEBFROST_SINGLEFILE_CONCURRENCY` (8) bound what SingleFile downloads; assets over the budget stay remote.
  - `WEBFROST_READABILITY_MAX_BYTES` (10 MB): Readability parses at most that much of a page.
  - `safeFetch(url, { signal })`, `fetchGuarded()` (redirect chain, raw body) and `runProcess(cmd, { signal, processGroup })` in `@webfrost/core`; `parseUrls(content, format, baseUrl)`.
- Updated dependencies [7d9766d]
- Updated dependencies [52700db]
- Updated dependencies [2d48590]
- Updated dependencies [ae07bb9]
- Updated dependencies [d9ffb71]
- Updated dependencies [60fd6e2]
- Updated dependencies [20bfc56]
- Updated dependencies [3afc954]
- Updated dependencies [3233cb7]
- Updated dependencies [54c5086]
- Updated dependencies [45bb4ba]
- Updated dependencies [52700db]
- Updated dependencies [8033935]
  - @webfrost/server@0.1.0
  - @webfrost/core@0.1.0
