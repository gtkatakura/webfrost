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

---

## Health

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check — returns `{ "status": "ok" }` |

---

## Setup (first run)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/setup/status` | No | Check if first-run setup is needed |
| `POST` | `/api/setup` | No | Complete first-run setup — creates admin user |

---

## Auth

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | No | Log in with `{ username, password }` — sets session cookie |
| `POST` | `/api/auth/logout` | Yes | Clear session cookie |
| `GET` | `/api/auth/me` | Yes | Returns current authenticated username |
| `POST` | `/api/auth/change-password` | Yes | Change the admin password |

---

## Snapshots

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/snapshots` | Submit a URL for archiving (HTTP 202 — async) |
| `GET` | `/api/snapshots` | List all snapshots. Supports `?page=X&limit=Y&status=<status>` |
| `GET` | `/api/snapshots?q=<term>` | Full-text search — returns ranked results with snippets |
| `GET` | `/api/snapshots/:id` | Get a snapshot with its archive results |
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

Supports pagination and optional status filter:

```bash
curl "http://localhost:3000/api/snapshots?page=1&limit=20" \
  -H "Authorization: Bearer wf_your_api_key_here"
# { "items": [...], "total": 42, "page": 1, "limit": 20 }
```

Filter by status (`pending`, `done`, or `failed`):

```bash
curl "http://localhost:3000/api/snapshots?status=pending" \
  -H "Authorization: Bearer wf_your_api_key_here"
```

### GET /api/snapshots (search)

```bash
curl "http://localhost:3000/api/snapshots?q=climate+change" \
  -H "Authorization: Bearer wf_your_api_key_here"
# [{ "id", "url", "snippet": "...climate <mark>change</mark>...", "rank" }]
```

---

## Archive files

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/snapshots/:id/archives/:extractor/download` | Download an archive file |

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
