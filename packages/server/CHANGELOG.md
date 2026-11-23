# @webfrost/server

## 0.3.2

### Patch Changes

- bbe007a: An API key that expires can no longer create a key that never expires or outlives it (`POST /settings/keys` answers `403`), so a leaked short-lived key cannot buy permanent access. A write that carries both a bearer token and the session cookie now gets the cross-origin check too, since auth falls back to the cookie when the token is not a valid key.
- bbe007a: The archiving browser now sends every connection through an SSRF egress proxy that checks the address it connects to. Shared and dedicated workers (including their WebSockets) and redirect hops can no longer reach internal hosts, and the browser is no longer open to DNS rebinding. The scroll pass is also capped at 15 seconds, so a page that replaces its own timers can no longer hang a snapshot.
- bbe007a: URL imports, feed imports and RSS schedules stop downloading at `WEBFROST_IMPORT_MAX_BYTES` (a larger `Content-Length` is refused before the body is read) instead of buffering up to 50 MB first. Fetch errors name the host you asked for, not the address the request was pinned to. The size backfill no longer records 0 bytes when storage fails for a reason other than a missing file; it retries later. `GET /imports` rejects malformed `page` and `limit` with `400`, as `GET /snapshots` does. Interrupted bundle imports are swept every five minutes, not only at startup, and an upload or import in progress is never swept.
- bbe007a: Search and listing are harder to abuse or break. `page` and `limit` that are not plain numbers (`Infinity`, `1e400`) answer 400 instead of a 500, and core clamps them to values the database accepts. On PostgreSQL and MySQL, a query is limited to 512 characters and 32 terms, snippets are built from the first 100,000 characters of a document, and characters such as `⑴` or `½` no longer put punctuation inside search tokens. On SQLite a database error is no longer reported as "no results". The size backfill behind `GET /stats` measures 16 files at a time and retries a failed lookup instead of storing 0 bytes.
- bbe007a: Downloads and previews are streamed instead of read whole into memory, and the `media-metadata` download only carries display fields (no yt-dlp stream URLs or headers). Deleting a snapshot that is still being archived answers `409` instead of leaving the files its pipeline writes afterwards in storage.
- bbe007a: Tags: one name rule everywhere. Names in any script keep their letters in the slug (`日本語`, `ação` and `aço` are separate tags instead of colliding on an empty or lossy slug), names are trimmed, and a name without a letter or digit is refused with 400. Bundle export only writes tag names the importer accepts. `webfrost tag add` finds an existing tag by slug instead of failing on a UNIQUE error. Concurrent bundle imports with the same new tag no longer fail, tag changes on a snapshot are serialised so the search index keeps up, and an interrupted bundle import is detected by its heartbeat and always leaves no files behind.
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
- Updated dependencies [bbe007a]
  - @webfrost/core@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [f502c66]
  - @webfrost/core@0.3.1

## 0.3.0

### Minor Changes

- 3fc46a1: Archive on your machine, keep it on the server. `webfrost push <id...> --to <url>` sends finished snapshots to a WebFrost server, which stores each one as a new snapshot with the same files, results, status, capture time and tags, without fetching anything again: useful when the server cannot archive a page itself (video sites often refuse server addresses) or to archive on a laptop and keep everything in one place. The API key comes from `WEBFROST_API_KEY`, never from a flag.
  
  Snapshots travel as snapshot bundles, one ZIP file with a `manifest.json` and the snapshot's files: `webfrost export <id> -o file.zip` writes one, `webfrost import file.zip` stores one in a local archive, the new `POST /api/v1/snapshots/import` route (`application/zip` body, `201 { id, url, status }`) and the SDK's `importSnapshot()` upload one. The server checks bundles strictly (manifest schema, known extractors, fixed file names, no unreferenced entries, size limits before and while decompressing) and accepts up to `WEBFROST_IMPORT_BUNDLE_MAX_BYTES` (default 2 GiB). Other routes now refuse a chunked request body without `Content-Length` (`411`).

### Patch Changes

- Updated dependencies [ed767b6]
- Updated dependencies [3fc46a1]
  - @webfrost/core@0.3.0

## 0.2.0

### Minor Changes

- 66ff385: `WEBFROST_DEFAULT_THEME` (`light` or `dark`) sets the web UI's theme for visitors who have not chosen one, with no flash of the other theme. Unset, the UI follows the system setting as before.
- 037d94f: A snapshot can be archived again in place. The snapshot's Details view has an **Archive again** button, the API has `POST /snapshots/:id/retry` (rate limited like snapshot creation, `409` while the snapshot is still being archived) and the SDK has `retrySnapshot(id)`. The snapshot keeps its id, address and color scheme, and every format is replaced by the new run: useful for a page that changed or a video a site refused the first time.

### Patch Changes

- 07c0901: Lists load a small thumbnail instead of the full-page screenshot: a WebP 640 px wide of the first screen, about 17 KB each, roughly 13 times less data on a page of cards. A long page gets a screenshot cut at 10000 px instead of none, with the extractor's whole time budget to paint it, and the card skeletons keep the layout still while the list loads.
- 66ff385: A video snapshot gets a poster: a representative frame taken with ffmpeg after the download (`media-poster`, `media/poster.jpg`). Lists show it instead of the page's thumbnail, and the player uses it as its cover.
- Updated dependencies [4ab82e0]
- Updated dependencies [07c0901]
- Updated dependencies [037d94f]
- Updated dependencies [07c0901]
- Updated dependencies [66ff385]
  - @webfrost/core@0.2.0

## 0.1.0

### Minor Changes

- 7d9766d: Freeze the HTTP API as v1 before 0.1.0.
  
  - **Versioned routes.** Every API route is served under `/api/v1`. The unversioned `/api/...` paths keep working as a deprecated alias (same handlers, same v1 response shapes) and answer with `Deprecation: true` and `Link: </api/v1/...>; rel="successor-version"`. The alias goes away in a later 0.x release. `/health` stays unversioned.
  - **One error shape.** Every error is `{ "error", "code" }`, rate-limit responses included (they keep `Retry-After`). New codes: `INVALID_CREDENTIALS` (wrong login, wrong current password), `FETCH_FAILED` (an import could not fetch its URL). An invalid URL or cron is now `VALIDATION` everywhere instead of `BAD_REQUEST` from some routes.
  - **One list envelope.** Tags, a snapshot's tags, schedules, imports history and API keys now return `{ items, total, page, limit }` with `page`/`limit` query parameters (limit capped at 200), like snapshots already did.
  - **ISO timestamps.** Every timestamp in a response is ISO 8601 UTC with a `Z` ("2026-11-21T21:42:38Z"). `POST /api/v1/settings/keys` accepts an optional ISO 8601 `expiresAt`.
  - **No storage paths in responses.** Each snapshot archive result has a `downloadUrl` and a `previewUrl` (archived HTML only). `content` carries data only for inline results (readability, html) and is null for file-backed ones, for admins and guests alike.
  
  Breaking for SDK users (0.x):
  
  - `baseUrl` is the server origin (`http://localhost:3000`); the client adds `/api/v1`. It is optional and defaults to the page's own origin. A legacy value ending in `/api` is normalised with a one-time warning.
  - `listTags`, `listSnapshotTags`, `listSchedules`, `listApiKeys` and `listImports` take `{ page, limit }` and return `Page<T>` instead of an array. New lazy iterators: `iterateTags`, `iterateSchedules`, `iterateApiKeys`, `iterateImports`.
  - `ArchiveResult` gains `downloadUrl` and `previewUrl` (absolute, resolved against `baseUrl`); `content` is null for file-backed results.
  - Error codes gain `INVALID_CREDENTIALS` and `FETCH_FAILED`; an invalid URL is `VALIDATION`.
  
  Also new: `createApiKey(name, { expiresAt })` takes an ISO string or a `Date`.
- 52700db: Pages are archived in a light or dark color scheme. The web UI archives in its current theme, so the screenshot, PDF and archived page look the way the person archiving sees the web; the API takes an optional `colorScheme` (`"light"` or `"dark"`) on `POST /api/v1/snapshots` and the SDK on `createSnapshot(url, { colorScheme })`. The CLI, schedules and imports use `WEBFROST_COLOR_SCHEME` (light by default). The scheme is stored per snapshot (schema version 4), so a re-run uses the same one.
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

- 54c5086: Server security fixes from the pre-release review:
  
  - **CSRF:** state-changing `/api` requests without a bearer token must come from the app's own origin (`Sec-Fetch-Site: same-origin`/`none`, or an `Origin` matching `Host`), otherwise `403 CROSS_ORIGIN_REQUEST`. Request bodies must be `application/json` (multipart only for `POST /api/import/file`), otherwise `415`.
  - **Rate limits behind a proxy:** with `WEBFROST_TRUST_PROXY=true` the client address is the right-most `X-Forwarded-For` entry (new `WEBFROST_TRUSTED_PROXY_HOPS`, default `1`), not the client-controlled left-most one. IPv6 clients are limited per `/64`.
  - **S3 downloads:** presigned URLs now sign `response-content-type` and `response-content-disposition: attachment`, so archived HTML never renders on the bucket's origin. `StorageBackend.presignedDownloadUrl` takes an optional third `response` argument.
  - **First-run setup:** new `WEBFROST_SETUP_TOKEN`; when set, `POST /api/setup` requires it (`setupToken` field or `X-Setup-Token` header, `403 SETUP_TOKEN_INVALID` otherwise), and the setup page asks for it. `GET /api/setup/status` reports `setupTokenRequired`. Without a token the server warns at startup while no admin exists. SDK: `completeSetup(username, password, setupToken?)` and `SetupStatusResult.setupTokenRequired`.
  - **Bind address:** new `HOST`. With `AUTH_DISABLED=true` the server binds to `127.0.0.1` unless `HOST` is set (default otherwise `0.0.0.0`). Containers that run with `AUTH_DISABLED=true` need `HOST=0.0.0.0`.
  - **Limits:** passwords up to 1024 characters, usernames 128, API key and tag names 100, URLs 8192 (`400 VALIDATION` beyond). Imports are capped by `WEBFROST_IMPORT_MAX_BYTES` (default 10 MiB) and `WEBFROST_IMPORT_MAX_URLS` (default 10000) with `413 PAYLOAD_TOO_LARGE`. `GET /api/snapshots` caps `limit` at 200.
  - **Errors:** every JSON error is `{ error, code }` with a machine-readable `code`. Unknown `/api/*` routes answer a JSON `404` instead of the SPA's HTML; malformed JSON is `400 INVALID_JSON`; validation failures are `400 VALIDATION` (login used to answer Elysia's `422`). Security headers are set on every response, errors included.
  - **Guests:** anonymous visitors (`WEBFROST_PUBLIC_READ`) see `extraction failed` instead of raw extractor errors.
  - **Sessions:** `POST /api/auth/logout` answers `204` and clears the cookie even when the session is expired or invalid. Logging in revokes the session in the cookie it replaces.
  - **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops accepting requests and the scheduler, then waits up to `WEBFROST_SHUTDOWN_TIMEOUT_MS` (default 20 s) for running archive jobs before exiting; unfinished jobs resume on the next start.
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
  - @webfrost/core@0.1.0
