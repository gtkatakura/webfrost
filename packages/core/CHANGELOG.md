# @webfrost/core

## 0.4.0

### Minor Changes

- ff682e9: A failed snapshot now says why it failed: the archive stores a category (`domain_not_found`, `page_not_found`, `access_denied`, `rate_limited`, `timeout`, …) and the message behind it, and the API and SDK return it as `failure: { category, class, label, detail }`. A domain that no longer resolves is remembered for ten minutes, so the other pages of a dead site in the same import fail at once without asking DNS again.
  
  The new **Review failures** page in the web UI groups the failed snapshots by why (domain gone, page gone, blocked, rate limited, temporary, …), then by domain, then snapshot by snapshot, with a filter and infinite scrolling. Retry, move to trash or delete for good many at once; only failed snapshots are touched, never an earlier snapshot of the same page that worked. Deleting for good asks you to type the domain name.
  
  Snapshots can now go to a **Trash**: hidden from every list, search and count (and from anonymous visitors of a public-read server by their address too), restorable, and deleted for good after 30 days (a setting, 1 to 365). A trashed snapshot still counts as a known URL for feed schedules, so a feed does not archive it again. New routes: `GET /failures`, `GET /failures/:group/domains`, `GET /failures/:group/domains/:host/snapshots`, `POST /failures/:group/{retry,trash,delete}`, `GET /trash`, `POST /trash/{restore,delete,empty}` and `GET`/`PATCH /settings/general`. Snapshots that failed before this version are in the **Reason not recorded** group.
  
  In traces, `error.type` on the `snapshot.archive` span is now that failure category (`page_not_found`, `network_error`, …) instead of `fetch_network` or `fetch_http_status`: update alerts that match the old values.
- ff682e9: New `webfrost rescue <group> --from <server>`: for every failed snapshot of a group on a server (for example the pages a site refuses to the server, "Blocked by the site"), archive the page on this machine, check the copy, and send the ones that work. A copy is sent only when it is done and is the page itself, not an anti-bot interstitial or a login wall with almost no text. The server stores it and moves the failure to its trash in one step, and only while the failure is still a failure of the same URL, so running it again carries on with what is left and never stores a page twice. A domain that fails here too is given up after three tries in a row.
  
  `POST /snapshots/import` takes `?replaces=<id>` for this (`409` when that snapshot is not, or no longer, a failure of the bundle's URL), and `GET /failures/:group/snapshots` lists a group's failed snapshots across domains; the SDK's `importSnapshot` takes `replaces` too. The failure lists answer faster on large archives.
  
  The browser no longer installs its own Ctrl+C handler, so the server's and the CLI's graceful stop (finish what is running, then exit) is what happens on the first signal.
  
  A snapshot in the trash can no longer be retried (`404`, as everywhere else it is hidden) until it is restored, and `webfrost export -o` over a larger existing file no longer leaves a corrupt bundle.
- ff682e9: SQLite search now goes through the same query parser as PostgreSQL and MySQL: words, `"phrase"`, `term*`, `OR` and `NOT` / `-term`, up to 512 characters and 32 terms. A query of thousands of `a*` terms or `NEAR` groups can no longer stall the server, which runs SQLite on its main thread. FTS5-only syntax (`NEAR`, `col:term`) is no longer taken: `title:x` searches every field for `x`. `q` longer than 1024 characters answers `400`.
- ff682e9: Filters look at the whole archive. In the web UI, **Filter by URL or title** on Snapshots and the status, date, extractor and tag filters on Search used to narrow only the 20 rows already on the page, so a snapshot on another page was never found. They are now answered by the database: the list, the count and the pages are of what matches in the archive, and the filter is kept in the address.
  
  `GET /snapshots` takes `since`, `before`, `extractor`, `tag` and `contains` (text in the URL or the title), and `status` takes several values; they work on the list and on a search (`q`). A value that cannot be read answers `400`. The SDK's `listSnapshots`, `iterateSnapshots` and `searchSnapshotsPage` take the same filters (`status`, `since`, `before`, `extractors`, `tags`, `contains`).

### Patch Changes

- 1d9df5e: The page fetch, SingleFile's resource fetches and the bookmark and feed imports send the headers of a Chrome navigation (`User-Agent`, `Accept`, `Accept-Language`). Servers that reset the connection or answer an error to a client that does not look like a browser used to fail the snapshot, although the browser of the same run opened the page. Troubleshooting has a new section for pages that open in a browser and fail to archive, including sites under a certificate authority the runtime does not know yet (`NODE_EXTRA_CA_CERTS`).
- ff682e9: - Retrying a snapshot takes its old text out of the search index, so it is not found by what it said before while it is archived again, or after the new run fails.
  - The trash purge and the sweep of interrupted imports check again, under the row's lock, that a snapshot is still expired or still a stale import: one restored and trashed again, or an import that finished meanwhile, is kept.
  - Concurrent requests for the stats share one measuring pass instead of each asking storage about every unmeasured file.
  - An uploaded bundle is removed even when the database cannot be opened to import it.
  - A failure's category no longer depends on words in the hostname or URL a site redirected to.
- ff682e9: - MySQL: a schema step interrupted after adding a column or an index runs again instead of failing every later start.
  - The server routes a request by the same path its request guard, auth check and rate limiters read (a short `Host` could make them see a different one), and refuses JSON bodies over 1 MiB before reading them, except on `POST /import`.
  - The `webfrost` binary no longer reads `.env` or `bunfig.toml` from the folder it is run in.
  - A `--headers-command` that leaves a process running no longer hangs the command line, and its timeout ends everything it started.
  - Pending `webfrost login` requests are counted per IPv6 /48, and a full store takes room from the client with the most of them.
  - Pages nested deeper than 512 elements, or with more than 100,000, are not handed to Readability, whose cost grows with the square of the depth.
- ff682e9: A run whose job was taken over by another worker (it stalled, and was presumed dead) can no longer overwrite the files of the run that took over. Each run writes its files in a folder of its own (`<snapshot>/.stage-<lease>/`) and moves each into place only while it still holds the job's lease; what it never moved is removed when it ends. `StorageBackend` gains an optional `stage` on `localPath`/`finalize` and `discardStage`.
- ff682e9: yt-dlp's requests now go through the SSRF egress proxy, like the browser's: a media page can no longer make yt-dlp fetch a private address (cloud metadata, a service on the server), whatever a site's extractor follows. The Mediasite extractors, which accept any host, are no longer used. If the proxy cannot start, media extraction is skipped rather than run unguarded.
- ff682e9: `webfrost rescue` hardening:
  - It no longer archives private addresses (localhost, the LAN, cloud metadata) from your machine just because the shell sets `WEBFROST_ALLOW_PRIVATE_URLS`: the addresses come from the server, so it takes an explicit `--allow-private`.
  - Each run has a scratch archive of its own (`rescue/run-*/`), so two runs at once no longer share ids or files or remove each other's.
  - Reading the text of a rendered page is a single pass: a page with a million unclosed `<template` tags can no longer hang the run.
  - When a copy replaces a failure (`POST /snapshots/import?replaces=`), every other failure of exactly the same address goes to the trash in the same transaction, so a run stopped right after an upload never sends that page again.
- ff682e9: `webfrost rescue` logs every run in `logs/` of the data directory (`rescue-<start time>.jsonl`): one JSON line per page as it is done, with its address, the outcome and the reason (and the server's new snapshot when rescued), then the summary. The record survives a closed terminal, Ctrl+C or a crash; `--no-log` skips it. The upload progress line no longer overwrites the pages' lines, and archiving no longer prints "Could not parse CSS stylesheet" for each stylesheet it cannot read.

## 0.3.2

### Patch Changes

- bbe007a: An API key that expires can no longer create a key that never expires or outlives it (`POST /settings/keys` answers `403`), so a leaked short-lived key cannot buy permanent access. A write that carries both a bearer token and the session cookie now gets the cross-origin check too, since auth falls back to the cookie when the token is not a valid key.
- bbe007a: The archiving browser now sends every connection through an SSRF egress proxy that checks the address it connects to. Shared and dedicated workers (including their WebSockets) and redirect hops can no longer reach internal hosts, and the browser is no longer open to DNS rebinding. The scroll pass is also capped at 15 seconds, so a page that replaces its own timers can no longer hang a snapshot.
- bbe007a: The CLI strips control characters (escape sequences included) from archived text, URLs and tag names before printing them. `webfrost doctor` no longer deletes a data directory it did not create (a symlink to an unmounted drive, for example). The concurrency limiter hands a freed slot straight to the next waiter, so the limit cannot be exceeded.
- bbe007a: Feed, OPML and bookmark imports parse in linear time: a hostile feed (unclosed tags, a million links) can no longer freeze the server or the schedule worker. URL imports, `webfrost import` and RSS schedules now all hold what they fetch to `WEBFROST_IMPORT_MAX_BYTES` and `WEBFROST_IMPORT_MAX_URLS`, relative feed links resolve against the URL reached after redirects, and `webfrost schedule add` no longer reports a database error as an invalid cron expression.
- bbe007a: URL imports, feed imports and RSS schedules stop downloading at `WEBFROST_IMPORT_MAX_BYTES` (a larger `Content-Length` is refused before the body is read) instead of buffering up to 50 MB first. Fetch errors name the host you asked for, not the address the request was pinned to. The size backfill no longer records 0 bytes when storage fails for a reason other than a missing file; it retries later. `GET /imports` rejects malformed `page` and `limit` with `400`, as `GET /snapshots` does. Interrupted bundle imports are swept every five minutes, not only at startup, and an upload or import in progress is never swept.
- bbe007a: Search and listing are harder to abuse or break. `page` and `limit` that are not plain numbers (`Infinity`, `1e400`) answer 400 instead of a 500, and core clamps them to values the database accepts. On PostgreSQL and MySQL, a query is limited to 512 characters and 32 terms, snippets are built from the first 100,000 characters of a document, and characters such as `⑴` or `½` no longer put punctuation inside search tokens. On SQLite a database error is no longer reported as "no results". The size backfill behind `GET /stats` measures 16 files at a time and retries a failed lookup instead of storing 0 bytes.
- bbe007a: Downloads and previews are streamed instead of read whole into memory, and the `media-metadata` download only carries display fields (no yt-dlp stream URLs or headers). Deleting a snapshot that is still being archived answers `409` instead of leaving the files its pipeline writes afterwards in storage.
- bbe007a: SSRF guard hardening. The HTTP fetch now connects to the address it checked (keeping the Host header and the TLS server name), so DNS rebinding can no longer swap in a private address between check and connect. IPv6 is limited to global unicast, with the IPv4 address inside IPv4-translated, 6to4 and NAT64 forms checked, and `::/96`, Teredo and local-use NAT64 refused. A 3xx other than 301/302/303/307/308 with a `Location` (a 300, or a 304) is archived as received instead of failing the snapshot. Decoding a page's `Content-Encoding` stops after three codings and 100 MB of output in all.
- bbe007a: Tags: one name rule everywhere. Names in any script keep their letters in the slug (`日本語`, `ação` and `aço` are separate tags instead of colliding on an empty or lossy slug), names are trimmed, and a name without a letter or digit is refused with 400. Bundle export only writes tag names the importer accepts. `webfrost tag add` finds an existing tag by slug instead of failing on a UNIQUE error. Concurrent bundle imports with the same new tag no longer fail, tag changes on a snapshot are serialised so the search index keeps up, and an interrupted bundle import is detected by its heartbeat and always leaves no files behind.

## 0.3.1

### Patch Changes

- f502c66: Pages that reveal their sections as you scroll, or load images only near the viewport, are archived whole: the browser scrolls through the page once (up to 20000 px, a few seconds) before the captures. SingleFile copies also inline the images that a page's own `<style>` blocks and `style` attributes point to, such as logos drawn with a CSS mask. On bun.sh both used to leave everything below the first screen blank.

## 0.3.0

### Minor Changes

- 3fc46a1: Archive on your machine, keep it on the server. `webfrost push <id...> --to <url>` sends finished snapshots to a WebFrost server, which stores each one as a new snapshot with the same files, results, status, capture time and tags, without fetching anything again: useful when the server cannot archive a page itself (video sites often refuse server addresses) or to archive on a laptop and keep everything in one place. The API key comes from `WEBFROST_API_KEY`, never from a flag.
  
  Snapshots travel as snapshot bundles, one ZIP file with a `manifest.json` and the snapshot's files: `webfrost export <id> -o file.zip` writes one, `webfrost import file.zip` stores one in a local archive, the new `POST /api/v1/snapshots/import` route (`application/zip` body, `201 { id, url, status }`) and the SDK's `importSnapshot()` upload one. The server checks bundles strictly (manifest schema, known extractors, fixed file names, no unreferenced entries, size limits before and while decompressing) and accepts up to `WEBFROST_IMPORT_BUNDLE_MAX_BYTES` (default 2 GiB). Other routes now refuse a chunked request body without `Content-Length` (`411`).

### Patch Changes

- ed767b6: An archived page keeps the theme it was archived in. Its stylesheets hold both themes behind `prefers-color-scheme`, which the browser answers with the viewer's system setting, so a page archived dark showed light on a light system. The SingleFile copy now fixes those conditions to the archived scheme.

## 0.2.0

### Minor Changes

- 037d94f: A snapshot can be archived again in place. The snapshot's Details view has an **Archive again** button, the API has `POST /snapshots/:id/retry` (rate limited like snapshot creation, `409` while the snapshot is still being archived) and the SDK has `retrySnapshot(id)`. The snapshot keeps its id, address and color scheme, and every format is replaced by the new run: useful for a page that changed or a video a site refused the first time.

### Patch Changes

- 4ab82e0: Long pages get their screenshot in about half a second instead of timing out: a page taller than the 10000 px limit is shot through a viewport that tall, so Chromium paints only what is kept instead of the whole page.
- 07c0901: Video prefers VP9 or AV1 with Opus, so it plays in Chromium builds without H.264 and AAC. H.264 and AAC come next, and AVI, FLV and WMV only when the site offers nothing else.
- 07c0901: Lists load a small thumbnail instead of the full-page screenshot: a WebP 640 px wide of the first screen, about 17 KB each, roughly 13 times less data on a page of cards. A long page gets a screenshot cut at 10000 px instead of none, with the extractor's whole time budget to paint it, and the card skeletons keep the layout still while the list loads.
- 66ff385: A video snapshot gets a poster: a representative frame taken with ffmpeg after the download (`media-poster`, `media/poster.jpg`). Lists show it instead of the page's thumbnail, and the player uses it as its cover.

## 0.1.0

### Minor Changes

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
- 2d48590: Cron expressions are validated per field (`60 * * * *` fails at once with an error naming the field) and gain ranges with steps (`1-10/2`), month and weekday names, `7` for Sunday and `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`. When both day-of-month and day-of-week are restricted a day now matches if either does (Vixie cron), as it does in standard cron. Next-run times are correct across DST changes in the process time zone: a skipped local time is skipped for that day and a repeated one fires once.
  
  The S3 backend uploads files from disk without loading them into memory, and keeps its temporary files in a private per-process directory instead of a shared `/tmp/webfrost-s3-tmp`.
- d9ffb71: When a video site refuses a video (private, removed, or asking to confirm the visitor is not a bot, as YouTube often does to server addresses), the `media` extractor now fails with yt-dlp's reason, shown in the snapshot's details, instead of being skipped without a word. Pages on sites yt-dlp does not support are still skipped silently.
- 60fd6e2: Videos are downloaded as an mp4 whenever the site offers one, so they play in the browser: archive.org, for example, lists an AVI first. When neither the video nor the audio can be downloaded, `media` fails with yt-dlp's reason instead of leaving only the metadata.
- 3233cb7: Titles, bylines and excerpts taken from a page's metadata no longer show raw HTML entities such as `&nbsp;` or `&#8211;`.
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
- 52700db: Archives of real sites come out complete. The browser waits for the network to settle after the page's load event (`WEBFROST_SETTLE_MS`, 5 s at most) before the capture, so single-page apps are no longer captured half-built or on their error screen; every request still goes through the SSRF guard. SingleFile copies keep their styles and images: stylesheet and image URLs are HTML-decoded before they are fetched (`&amp;` in a query string, as on Wikipedia), an inlined stylesheet keeps its `media` query, `srcset` and `<picture>` sources that pointed back to the network are dropped, and images and icons that stylesheets point to are inlined too. PDFs print backgrounds. Videos are downloaded at up to 1080p in H.264 and AAC, which every browser plays (`WEBFROST_MEDIA_MAX_HEIGHT`), instead of the largest format available. Readable text keeps its paragraph breaks, and pages that are not articles take their title from `<title>`.
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
