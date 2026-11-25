# @webfrost/sdk

## 0.4.0

### Minor Changes

- ff682e9: New `webfrost login <server>`: connect the CLI to a server without creating and copying an API key. The command shows a short code and opens the server's web UI (**Connect a command line**), where you, signed in, approve the request that shows the same code; the server then creates an API key for that machine, listed and revocable under Settings, API keys. The key is saved in `~/.config/webfrost/credentials.json` (readable by you only) and `push` and `rescue` use it for that server; `WEBFROST_API_KEY` still works and takes precedence. `webfrost logout <server>` revokes the key and forgets it.
  
  It follows the OAuth 2.0 Device Authorization Grant (RFC 8628): `POST /auth/device` and `POST /auth/device/token` for the command line (no credentials, rate limited; nothing is created before an approval), `GET /auth/device/requests/:userCode` and `POST /auth/device/requests/:userCode/approve|deny` for the web UI (session only). The SDK gains `startDeviceAuthorization`, `pollDeviceAuthorization`, `getDeviceRequest`, `approveDeviceRequest` and `denyDeviceRequest`.
  
  A server behind a proxy that asks for its own sign-in is reachable too, with nothing tied to one product: `webfrost login --headers-command '<command>'` takes a command that prints the headers the proxy wants (its token tool), saved with the key and run again by `push`, `rescue` and `logout`; `WEBFROST_HEADERS` gives fixed headers (a service token) and `WEBFROST_HEADERS_COMMAND` a command for one run. They are sent only to that server, never printed or saved, and never in place of the API key. A server on a private network (a VPN, a tailnet) needs none of it.
- ff682e9: A failed snapshot now says why it failed: the archive stores a category (`domain_not_found`, `page_not_found`, `access_denied`, `rate_limited`, `timeout`, …) and the message behind it, and the API and SDK return it as `failure: { category, class, label, detail }`. A domain that no longer resolves is remembered for ten minutes, so the other pages of a dead site in the same import fail at once without asking DNS again.
  
  The new **Review failures** page in the web UI groups the failed snapshots by why (domain gone, page gone, blocked, rate limited, temporary, …), then by domain, then snapshot by snapshot, with a filter and infinite scrolling. Retry, move to trash or delete for good many at once; only failed snapshots are touched, never an earlier snapshot of the same page that worked. Deleting for good asks you to type the domain name.
  
  Snapshots can now go to a **Trash**: hidden from every list, search and count (and from anonymous visitors of a public-read server by their address too), restorable, and deleted for good after 30 days (a setting, 1 to 365). A trashed snapshot still counts as a known URL for feed schedules, so a feed does not archive it again. New routes: `GET /failures`, `GET /failures/:group/domains`, `GET /failures/:group/domains/:host/snapshots`, `POST /failures/:group/{retry,trash,delete}`, `GET /trash`, `POST /trash/{restore,delete,empty}` and `GET`/`PATCH /settings/general`. Snapshots that failed before this version are in the **Reason not recorded** group.
  
  In traces, `error.type` on the `snapshot.archive` span is now that failure category (`page_not_found`, `network_error`, …) instead of `fetch_network` or `fetch_http_status`: update alerts that match the old values.
- ff682e9: New `webfrost rescue <group> --from <server>`: for every failed snapshot of a group on a server (for example the pages a site refuses to the server, "Blocked by the site"), archive the page on this machine, check the copy, and send the ones that work. A copy is sent only when it is done and is the page itself, not an anti-bot interstitial or a login wall with almost no text. The server stores it and moves the failure to its trash in one step, and only while the failure is still a failure of the same URL, so running it again carries on with what is left and never stores a page twice. A domain that fails here too is given up after three tries in a row.
  
  `POST /snapshots/import` takes `?replaces=<id>` for this (`409` when that snapshot is not, or no longer, a failure of the bundle's URL), and `GET /failures/:group/snapshots` lists a group's failed snapshots across domains; the SDK's `importSnapshot` takes `replaces` too. The failure lists answer faster on large archives.
  
  The browser no longer installs its own Ctrl+C handler, so the server's and the CLI's graceful stop (finish what is running, then exit) is what happens on the first signal.
  
  A snapshot in the trash can no longer be retried (`404`, as everywhere else it is hidden) until it is restored, and `webfrost export -o` over a larger existing file no longer leaves a corrupt bundle.
- ff682e9: Filters look at the whole archive. In the web UI, **Filter by URL or title** on Snapshots and the status, date, extractor and tag filters on Search used to narrow only the 20 rows already on the page, so a snapshot on another page was never found. They are now answered by the database: the list, the count and the pages are of what matches in the archive, and the filter is kept in the address.
  
  `GET /snapshots` takes `since`, `before`, `extractor`, `tag` and `contains` (text in the URL or the title), and `status` takes several values; they work on the list and on a search (`q`). A value that cannot be read answers `400`. The SDK's `listSnapshots`, `iterateSnapshots` and `searchSnapshotsPage` take the same filters (`status`, `since`, `before`, `extractors`, `tags`, `contains`).

### Patch Changes

- ff682e9: `searchSnapshots("")` and `searchSnapshotsPage("")` return an empty result instead of the plain list typed as search results, and a result always has a `snippet` (string) and a `rank` (number). A signal passed to many requests (downloads, and failed or retried ones) no longer collects one abort listener per request. The docs no longer suggest `credentials: "include"` for cookie auth from another origin, which the server does not allow: use an API key there.
- ff682e9: - The `webfrost login` and `webfrost rescue` commands the web UI offers to copy carry the server's origin only: a link with shell syntax in its path can no longer put it into a command someone pastes.
  - Typing in a filter or search box no longer undoes a filter clicked, or a Back pressed, while the text waited to be sent.
  - The snapshot filter takes at most the 200 characters the server accepts, instead of failing the whole list.
  - A search page past the end steps back to the last page, as the snapshot list does.
  - "Select all" on a failure group ends when the list's totals change, so a confirmation never shows fewer snapshots than will be acted on.
  - `POST /failures/:group/trash` answers with the `ids` it moved, and Undo restores exactly those (one already in the trash stays there).

## 0.3.2

### Patch Changes

- bbe007a: Tags: one name rule everywhere. Names in any script keep their letters in the slug (`日本語`, `ação` and `aço` are separate tags instead of colliding on an empty or lossy slug), names are trimmed, and a name without a letter or digit is refused with 400. Bundle export only writes tag names the importer accepts. `webfrost tag add` finds an existing tag by slug instead of failing on a UNIQUE error. Concurrent bundle imports with the same new tag no longer fail, tag changes on a snapshot are serialised so the search index keeps up, and an interrupted bundle import is detected by its heartbeat and always leaves no files behind.

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- 3fc46a1: Archive on your machine, keep it on the server. `webfrost push <id...> --to <url>` sends finished snapshots to a WebFrost server, which stores each one as a new snapshot with the same files, results, status, capture time and tags, without fetching anything again: useful when the server cannot archive a page itself (video sites often refuse server addresses) or to archive on a laptop and keep everything in one place. The API key comes from `WEBFROST_API_KEY`, never from a flag.
  
  Snapshots travel as snapshot bundles, one ZIP file with a `manifest.json` and the snapshot's files: `webfrost export <id> -o file.zip` writes one, `webfrost import file.zip` stores one in a local archive, the new `POST /api/v1/snapshots/import` route (`application/zip` body, `201 { id, url, status }`) and the SDK's `importSnapshot()` upload one. The server checks bundles strictly (manifest schema, known extractors, fixed file names, no unreferenced entries, size limits before and while decompressing) and accepts up to `WEBFROST_IMPORT_BUNDLE_MAX_BYTES` (default 2 GiB). Other routes now refuse a chunked request body without `Content-Length` (`411`).

## 0.2.0

### Minor Changes

- 037d94f: A snapshot can be archived again in place. The snapshot's Details view has an **Archive again** button, the API has `POST /snapshots/:id/retry` (rate limited like snapshot creation, `409` while the snapshot is still being archived) and the SDK has `retrySnapshot(id)`. The snapshot keeps its id, address and color scheme, and every format is replaced by the new run: useful for a page that changed or a video a site refused the first time.

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
- 864316e: The SDK is ready to publish to npm as `@webfrost/sdk`.
  
  - Type declarations are generated and shipped (`dist/index.d.ts`); the package is ESM with a proper `exports` map, and the tarball holds only `dist`, the README and the LICENSE. Verified with publint and Are the Types Wrong.
  - New client options: `timeoutMs` (default 30s, `0` disables), `fetch`, `credentials` (default `"same-origin"`) and `retries` / `retryDelayMs` / `maxRetryDelayMs` (GET and HEAD only, exponential backoff with jitter, honours `Retry-After`).
  - Every method takes a trailing `{ signal }` to abort the request.
  - `WebFrostError` gains `code` (the server's machine-readable code, or `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, `INVALID_RESPONSE`); network failures and timeouts are now `WebFrostError` instead of a raw `TypeError`. The server's `{ error, code }` body is surfaced by every method, GETs included.
  - New methods: `iterateSnapshots`, `importFile`, `archiveUrl`, `downloadArchive`.
  - All public types are exported (`SetupResult`, `SetupStatusResult`, `ExtractorMeta`, `RequestOptions`, ...). Snapshot status is `"pending" | "done" | "failed"` and a schedule's `lastStatus` is `"success" | "failed" | null`.
  - Breaking: `SearchResult.status` is `null` instead of `""` when the server reports none; `ListSnapshotsOptions.status` only accepts the status union.

### Patch Changes

- be206bf: `ImportRecord.id` is typed as the string (UUID) the server actually returns, not a number.
  
  The documentation moved from VitePress in `docs/` to a prerendered site in `apps/docs` (React Router + Vite + Fumadocs), with a landing page, search, and 27 pages rewritten against the code.
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
