# Reference: REST API

The server (`@webfrost/server`) exposes a REST API at `http://localhost:3000/api`.

All `/api/*` routes require authentication (Bearer token or session cookie) **except**:
- `POST /api/auth/login`
- `GET /health`
- `GET /api/setup/status`
- `POST /api/setup`

---

## Authentication

Pass your API key as a Bearer token:

```bash
curl -H "Authorization: Bearer wf_your_api_key_here" \
  http://localhost:3000/api/snapshots
```

Create API keys via `webfrost admin key create` or **Settings → API Keys** in the UI.

Browser clients use a session cookie instead (set by `POST /api/auth/login` or `POST /api/setup`). Sessions are stored server-side: logout revokes the session, and changing the password revokes all sessions and returns a fresh cookie to the caller.

Unauthenticated requests get `401`.

### Public read

With `WEBFROST_PUBLIC_READ=true` the following work without credentials, so the archive can be browsed by anyone who can reach the server:

- `GET /api/snapshots` (list and `?q=` search), `GET /api/snapshots/:id`, `GET /api/snapshots/:id/tags`
- `GET /api/snapshots/:id/archives/:extractor/download` and `/preview`
- `GET /api/tags`, `GET /api/stats`

Everything else — every `POST`/`PATCH`/`DELETE`, and schedules, imports, settings, API keys and `GET /api/auth/me` — still answers `401`. For anonymous callers, the `content` of file-backed archive results is the download URL instead of the server's storage path.

---

## Rate limits

Limits are per client IP over a 1-minute sliding window:

| Scope | Limit |
|---|---|
| `GET` / `HEAD` on `/api/*` | 300 / min |
| `POST /api/snapshots`, `POST /api/import`, `POST /api/import/file` | 60 / min |
| `POST /api/auth/login`, `POST /api/auth/change-password`, `POST /api/setup` | 10 / min |

A limited request gets `429` with a `Retry-After` header. The client IP is the TCP peer address; `X-Forwarded-For` is only used when `WEBFROST_TRUST_PROXY=true` (set it behind a reverse proxy).

---

## Health

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check — returns `{ "status": "ok" }` |

---

## Setup (first run)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/setup/status` | No | `{ needsSetup, publicRead }` — whether first-run setup is needed and whether public read is on |
| `POST` | `/api/setup` | No | Complete first-run setup — creates admin user |

`POST /api/setup` takes `{ "username", "password" }`. `username` must be non-empty and `password` at least 8 characters, otherwise the response is `400`. It returns `{ "apiKey": "..." }` (shown once) and sets a session cookie. Once an admin user exists it returns `409`.

---

## Auth

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | No | Log in with `{ username, password }` — sets session cookie |
| `POST` | `/api/auth/logout` | Yes | Revoke the session and clear the cookie |
| `GET` | `/api/auth/me` | Yes | Returns current authenticated username |
| `POST` | `/api/auth/change-password` | Yes | Change the admin password — `{ currentPassword, newPassword }` |

`POST /api/auth/change-password` returns `400` if `newPassword` is shorter than 8 characters and **`403`** if `currentPassword` is wrong (not `401`, because the caller is authenticated). On success all of the user's sessions are revoked and the caller gets a fresh session cookie.

---

## Snapshots

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/snapshots` | Submit a URL for archiving (HTTP 202 — async) |
| `GET` | `/api/snapshots` | List all snapshots. Supports `?page=X&limit=Y&status=<status>` |
| `GET` | `/api/snapshots?q=<term>` | Full-text search — returns ranked results with snippets |
| `GET` | `/api/snapshots/:id` | Get a snapshot with its archive results and per-extractor metadata |
| `DELETE` | `/api/snapshots/:id` | Delete a snapshot and its archive files |

### POST /api/snapshots

```bash
curl -X POST http://localhost:3000/api/snapshots \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# HTTP 202 — { "id": 1, "url": "https://example.com", "status": "pending" }
```

### GET /api/snapshots (list)

Newest first. Supports pagination and optional status filter:

```bash
curl "http://localhost:3000/api/snapshots?page=1&limit=20" \
  -H "Authorization: Bearer wf_your_api_key_here"
# { "items": [...], "total": 42, "page": 1, "limit": 20 }
```

Each item is `{ id, url, status, createdAt, extractors, title, excerpt, screenshotUrl, tags }`. `extractors` lists only the extractors that succeeded; `title` and `excerpt` come from the readability extractor and `screenshotUrl` is null when there is no screenshot.

Filter by status (`pending`, `done`, or `failed`):

```bash
curl "http://localhost:3000/api/snapshots?status=pending" \
  -H "Authorization: Bearer wf_your_api_key_here"
```

### Snapshot status

A snapshot is `pending` until its pipeline finishes. It then becomes `done` when at least one extractor produced output, or `failed` when the page could not be fetched or no extractor succeeded. There are no other statuses.

### GET /api/snapshots/:id

```bash
curl http://localhost:3000/api/snapshots/1 \
  -H "Authorization: Bearer wf_your_api_key_here"
```

The response has the same summary fields as a list item (`id`, `url`, `status`, `createdAt`, `extractors`, `title`, `excerpt`, `screenshotUrl`, `tags`) plus:

- `archiveResults` — `[{ id, extractor, content, createdAt }]` for extractors that succeeded.
- `extractorMeta` — an object keyed by extractor name: `{ status: "success" | "failed", durationMs, fileSizeBytes, error? }`.

Browser extractors (`pdf`, `screenshot`, `dom-snapshot`, `singlefile`) that could not run — Chromium missing, navigation failed, or an SSRF policy violation — appear in `extractorMeta` with `status: "failed"` and an `error`, and are absent from `extractors` and `archiveResults`. The `media` extractor is skipped silently (no entry) when `yt-dlp` is not installed or the URL is not a media page. Unknown ids return `404`.

### GET /api/snapshots (search)

```bash
curl "http://localhost:3000/api/snapshots?q=climate+change&page=1&limit=20" \
  -H "Authorization: Bearer wf_your_api_key_here"
# { "items": [...], "total": 5, "page": 1, "limit": 20 }
```

Results are ranked by relevance; `status=` filters them the same way as the list. Each item is `{ id, url, snippet, rank, status, createdAt, extractors, title, excerpt, screenshotUrl, tags }`, for example `"snippet": "...climate <mark>change</mark>..."`. The `snippet` is HTML-escaped; the only markup is the literal `<mark>` tag, so it is safe to render as text with highlights, but never as raw HTML from untrusted sources. Tag names are part of the search index, and are kept in sync when you add or remove tags after archiving.

---

## Archive files

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/snapshots/:id/archives/:extractor/download` | Download an archive file |
| `GET` | `/api/snapshots/:id/archives/:extractor/preview` | Render archived HTML (`dom-snapshot` or `singlefile` only) inline with a `sandbox` Content-Security-Policy — used by the web UI's preview iframe. `400` for any other extractor. |

Available extractor names: `warc`, `pdf`, `screenshot`, `readability`, `dom-snapshot`, `singlefile`, `html`, `media`, `media-metadata`.

```bash
curl -O -J \
  http://localhost:3000/api/snapshots/1/archives/screenshot/download \
  -H "Authorization: Bearer wf_your_api_key_here"
```

---

## Tags

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/tags` | List all tags |
| `POST` | `/api/tags` | Create a tag |
| `DELETE` | `/api/tags/:id` | Delete a tag (removes from all snapshots) |
| `GET` | `/api/snapshots/:id/tags` | List tags on a snapshot |
| `POST` | `/api/snapshots/:id/tags` | Add a tag to a snapshot |
| `DELETE` | `/api/snapshots/:id/tags/:tagId` | Remove a tag from a snapshot |

---

## Schedules

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/schedules` | Add a recurring archive schedule |
| `GET` | `/api/schedules` | List all schedules (includes `paused`, `lastStatus`, `consecutiveFailures`) |
| `GET` | `/api/schedules/:id` | Get a single schedule |
| `PATCH` | `/api/schedules/:id` | Pause or resume — `{ "paused": true\|false }` |
| `DELETE` | `/api/schedules/:id` | Remove a schedule |

---

## Import

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/import` | Bulk import from a URL (RSS, OPML, Netscape HTML, or plain text — HTTP 202 async) |
| `POST` | `/api/import/file` | Bulk import from an uploaded file (multipart/form-data — HTTP 202 async) |

### Import from URL

```bash
curl -X POST http://localhost:3000/api/import \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/feed.xml", "format": "rss"}'
# HTTP 202 — { "queued": 12, "skipped": 3, "total": 15, "format": "rss" }
```

### Import from file upload

```bash
curl -X POST http://localhost:3000/api/import/file \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -F "file=@bookmarks.html" \
  -F "format=netscape"
# HTTP 202 — { "queued": 45, "skipped": 2, "total": 47, "format": "netscape" }
```

Supported `format` values: `rss`, `opml`, `netscape`, `text`.

---

## Settings

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/settings/info` | Get server info (version, storage path, snapshot count) |
| `GET` | `/api/settings/keys` | List API keys |
| `POST` | `/api/settings/keys` | Create an API key |
| `DELETE` | `/api/settings/keys/:id` | Revoke an API key |
