# @webfrost/ui

## 0.3.2

### Patch Changes

- bbe007a: Tags: one name rule everywhere. Names in any script keep their letters in the slug (`日本語`, `ação` and `aço` are separate tags instead of colliding on an empty or lossy slug), names are trimmed, and a name without a letter or digit is refused with 400. Bundle export only writes tag names the importer accepts. `webfrost tag add` finds an existing tag by slug instead of failing on a UNIQUE error. Concurrent bundle imports with the same new tag no longer fail, tag changes on a snapshot are serialised so the search index keeps up, and an interrupted bundle import is detected by its heartbeat and always leaves no files behind.
- Updated dependencies [bbe007a]
  - @webfrost/sdk@0.3.2

## 0.3.1

### Patch Changes

- @webfrost/sdk@0.3.1

## 0.3.0

### Patch Changes

- ed767b6: An archived page keeps the theme it was archived in. Its stylesheets hold both themes behind `prefers-color-scheme`, which the browser answers with the viewer's system setting, so a page archived dark showed light on a light system. The SingleFile copy now fixes those conditions to the archived scheme.
- f30bcd9: Loading placeholders now have the shape of what they stand in for, so nothing jumps when the data arrives: the viewer shows the open view (page, reader column, file list, details) and title lines instead of a few bars of text, search results and the dashboard feed have their real rows, the snapshot list rows keep their columns, and the app's frame shows while the session is checked instead of a blank screen. A view picked in the viewer before the snapshot finished loading is no longer switched back to the default one.
- Updated dependencies [3fc46a1]
  - @webfrost/sdk@0.3.0

## 0.2.0

### Minor Changes

- 66ff385: `WEBFROST_DEFAULT_THEME` (`light` or `dark`) sets the web UI's theme for visitors who have not chosen one, with no flash of the other theme. Unset, the UI follows the system setting as before.
- 037d94f: A snapshot can be archived again in place. The snapshot's Details view has an **Archive again** button, the API has `POST /snapshots/:id/retry` (rate limited like snapshot creation, `409` while the snapshot is still being archived) and the SDK has `retrySnapshot(id)`. The snapshot keeps its id, address and color scheme, and every format is replaced by the new run: useful for a page that changed or a video a site refused the first time.

### Patch Changes

- 07c0901: Lists load a small thumbnail instead of the full-page screenshot: a WebP 640 px wide of the first screen, about 17 KB each, roughly 13 times less data on a page of cards. A long page gets a screenshot cut at 10000 px instead of none, with the extractor's whole time budget to paint it, and the card skeletons keep the layout still while the list loads.
- 66ff385: A video snapshot gets a poster: a representative frame taken with ffmpeg after the download (`media-poster`, `media/poster.jpg`). Lists show it instead of the page's thumbnail, and the player uses it as its cover.
- Updated dependencies [037d94f]
  - @webfrost/sdk@0.2.0

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
- e2935df: The web UI gets the WebFrost look and a round of fixes.
  
  - **Ice Blue brand.** The design tokens now match the docs site (light and dark), with the hexagon mark and the "Web**Frost**" wordmark in the sidebar, the mobile header, and the login and setup pages, and the arctic fox on the login, setup and empty-archive screens. Text colors meet WCAG AA contrast.
  - **Errors are no longer silent.** A failed query on the snapshot list, dashboard, schedules, API keys, tags or import history shows an error with Retry instead of "No snapshots yet". Creating or deleting a tag reports failures. When the server cannot be reached the app says "Can't reach the WebFrost server" with Retry instead of showing the login form. Copying the one-time API key works on plain-HTTP origins, or selects the key so you can copy it yourself.
  - **Safer bulk actions.** Selections no longer survive a page or filter change, so bulk delete only touches rows you can see, and the confirmation says exactly how many snapshots will be deleted.
  - **One detail view.** `/snapshots/:id` opens the slide-over panel over the list (the standalone detail page is gone; `?detail=` still works). The panel keeps your tab while a pending snapshot refreshes, and a malformed id opens nothing.
  - **Forgiving URL fields.** "example.com" is accepted and archived as `https://example.com/`, with an inline message for anything that is not a web address.
  - **Also fixed:** the Search page no longer overwrites what you are typing, the list page number is kept in the URL and clamped after deletes.
  - **Accessibility.** One dialog component (focus trap, Escape, focus restore) for the command palette, the shortcuts help and the detail panel; listbox semantics in the palette; tabs with arrow-key navigation; a shared focus ring; labelled icon buttons; reduced-motion support.
  - **Phone layout.** The snapshot list wraps and drops secondary columns, the detail panel is full width with the metadata below the content, and the mobile menu is a single drawer that is inert when closed and closes with Escape.
  - **Code health.** The largest pages are split into feature folders, dead components and duplicated parsers are gone, and error messages, local-storage keys and the delete mutation each live in one place.
- bede924: A snapshot opens on the whole window instead of a side panel: one slim bar (Back, title, original URL, the views, full screen, open in a new tab) over the archived page itself, which is the first view (**Page**, formerly **DOM**), or the video when there is one (**Media**). **Details** (status, tags, extractors, history, Delete) is a view like the others (`I`); `F` shows the page full screen and `Escape` goes back to the list page you came from. The archived page follows the app's theme when its CSS has a dark mode. The snapshot list opens as **Cards** with large screenshots; rows are still one click away. New shortcuts: `/` focuses the search or filter field of the page, `Ctrl+B` (`Cmd+B`) shows or hides the sidebar. **Raw** is now **Files**.

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
- 50138a5: Polish the web UI: one page header and a 12px floor for text, readable tag chips on any colour, extractors that were not captured are no longer shown in red, the dashboard's recent activity leads with page titles, schedules stack into cards on a phone and name fixed daily or hourly times ("Daily at 06:00"), and search filters are full-width rows.
- Updated dependencies [7d9766d]
- Updated dependencies [52700db]
- Updated dependencies [be206bf]
- Updated dependencies [ae07bb9]
- Updated dependencies [864316e]
- Updated dependencies [54c5086]
  - @webfrost/sdk@0.1.0
