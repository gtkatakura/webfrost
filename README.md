# WebFrost

A self-hosted web archiving toolkit. Archive URLs to WARC, Readability JSON, PDF, full-page screenshots, DOM snapshots, and self-contained HTML with one command. One shared HTTP cache, one browser navigation per snapshot, durable open formats (files + SQLite), no lock-in.

---

## Quickstart

**Requirements:** [Bun](https://bun.sh) v1.x, Chromium (for PDF/screenshot extractors)

```bash
# Clone and install
git clone https://github.com/<org>/webfrost.git
cd webfrost
bun install

# Create the data directory and initialize the archive
mkdir -p ./data
WEBFROST_DIR=./data bun run webfrost init

# Archive a URL
WEBFROST_DIR=./data bun run webfrost add https://example.com

# List snapshots
WEBFROST_DIR=./data bun run webfrost list
```

Or run the server with UI:

```bash
mkdir -p ./data
# Build the UI (required once, or after UI changes)
bun run build
# Generate a session secret (required for auth)
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
# Create your admin user (first time only)
WEBFROST_DIR=./data bun run webfrost admin create --username admin --password <your-password>
# Open http://localhost:3000
```

---

## Docker (production)

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v /path/to/local/data:/data \
  ghcr.io/<org>/webfrost/server:latest

# Create your admin user after the container starts (first time only)
docker exec <container-id> \
  webfrost admin create --username admin --password <your-password>
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for full deployment instructions, env vars, and Docker Compose setup.

---

## Getting Started

### Prerequisites

- **[Bun](https://bun.sh) v1.x** — package manager and runtime
- **Chromium** — required for PDF, screenshot, DOM snapshot, and SingleFile extractors
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — optional; required for media extraction (video/audio)
- **SQLite** — bundled with Bun, no installation needed

---

### CLI Getting Started

The CLI is the fastest way to start archiving locally.

> **Note:** The examples below use `webfrost` directly, which works after global install. During development from the repo, prefix commands with `bun run`: e.g. `WEBFROST_DIR=./data bun run webfrost add https://example.com`.

**1. Initialize the archive:**

```bash
WEBFROST_DIR=./data webfrost init
# Initialized archive at ./data
```

**2. Archive a URL:**

```bash
WEBFROST_DIR=./data webfrost add https://example.com
# Archiving https://example.com...
# ✓ snapshot abc123 — warc, pdf, screenshot, readability, dom-snapshot, singlefile
```

**3. List snapshots:**

```bash
WEBFROST_DIR=./data webfrost list
# ID       URL                    Date
# abc123   https://example.com    2024-01-15 10:23:01
```

**4. Search archived content:**

```bash
WEBFROST_DIR=./data webfrost search "example domain"
# abc123   https://example.com    score: 1.42
#   "...This domain is for use in <mark>illustrative examples</mark>..."
```

**5. Delete a snapshot:**

```bash
WEBFROST_DIR=./data webfrost delete abc123
# Deleted snapshot abc123 and its archive files
```

**6. Work with tags:**

```bash
# Create a tag
WEBFROST_DIR=./data webfrost tag create "research" --color "#4f46e5"

# Tag a snapshot
WEBFROST_DIR=./data webfrost tag add abc123 research

# List all tags
WEBFROST_DIR=./data webfrost tag list

# List tags on a specific snapshot
WEBFROST_DIR=./data webfrost tag list abc123
```

**7. Schedule recurring archives:**

```bash
# Archive a URL every day at midnight
WEBFROST_DIR=./data webfrost schedule add https://example.com/news --cron "0 0 * * *"

# Archive an RSS feed every hour
WEBFROST_DIR=./data webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"

# List schedules
WEBFROST_DIR=./data webfrost schedule list

# Start the background schedule worker
WEBFROST_DIR=./data webfrost schedule worker
```

**8. Bulk import URLs:**

```bash
# From a plain text file (one URL per line)
WEBFROST_DIR=./data webfrost import urls.txt

# From an OPML feed list
WEBFROST_DIR=./data webfrost import subscriptions.opml

# From Netscape bookmark HTML (browser export)
WEBFROST_DIR=./data webfrost import bookmarks.html

# From an RSS feed URL
WEBFROST_DIR=./data webfrost import --format rss https://example.com/feed.xml
```

**9. Admin setup (server use):**

```bash
# Create admin user and default API key (run once)
WEBFROST_DIR=./data webfrost admin create --username admin --password <password>

# Create additional API keys
WEBFROST_DIR=./data webfrost admin key create --name "my-script"

# List active API keys
WEBFROST_DIR=./data webfrost admin key list

# Revoke a key
WEBFROST_DIR=./data webfrost admin key revoke <key-id>
```

---

### Server + Web UI Getting Started

The server adds a REST API, authentication, and a full React UI at `http://localhost:3000`.

**1. Build the UI and start the server:**

```bash
mkdir -p ./data
bun run build                  # Build UI assets (required once, or after UI changes)
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
# Server running at http://localhost:3000
```

**2. Complete first-run setup:**

Open `http://localhost:3000` in your browser. The first-run setup wizard appears automatically if no admin user exists. Enter a username and password to create the admin account, or use the CLI:

```bash
WEBFROST_DIR=./data webfrost admin create --username admin --password <password>
```

**3. Log in:**

Navigate to `http://localhost:3000/login`, enter your credentials, and you'll land on the snapshot list.

**4. Archive a URL from the UI:**

Click **"Add URL"** on the snapshot list page, enter a URL, and click **Archive**. The snapshot appears once the pipeline finishes (typically a few seconds).

**5. View snapshot detail:**

Click any snapshot to open the detail page. Each extractor output (WARC, PDF, screenshot, readability, DOM, SingleFile) is listed with a download link.

**6. Manage tags:**

Navigate to **Tags** (`/tags`) to create and manage tags. On any snapshot detail page, click **Add tag** to associate tags.

**7. View and manage schedules:**

Navigate to **Schedules** (`/schedules`) to create recurring archive jobs. Set a URL (or RSS feed) and a cron expression.

**8. Import URLs:**

Navigate to **Import** (`/import`) to bulk-import from an RSS feed URL, an OPML file, a Netscape bookmark export, or a plain-text URL list.

**9. Manage API keys:**

Navigate to **Settings → API Keys** (`/settings/api-keys`) to create or revoke API keys for scripting and SDK use.

---

### SDK Getting Started

`@webfrost/sdk` is a TypeScript client for the server API.

**1. Install:**

```bash
bun add @webfrost/sdk
# or: npm install @webfrost/sdk
```

**2. Create a client:**

```typescript
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000",
  apiKey: "wf_your_api_key_here",
});
```

**3. Create a snapshot:**

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending" }
```

**4. List snapshots:**

```typescript
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });
// items: [{ id, url, createdAt, extractors: [...], tags: [...] }]
```

**5. Search:**

```typescript
const results = await client.searchSnapshots("climate change policy");
// [{ id, url, snippet: "...climate <mark>change</mark>...", rank }]
```

**6. Delete a snapshot:**

```typescript
await client.deleteSnapshot(1);
```

**7. Manage tags:**

```typescript
// Create a tag
const tag = await client.createTag("research", "#4f46e5");

// Add tag to snapshot
await client.addTagToSnapshot(1, tag.id);

// List tags on a snapshot
const tags = await client.listSnapshotTags(1);

// Remove a tag from snapshot
await client.removeTagFromSnapshot(1, tag.id);
```

**8. Import URLs programmatically:**

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss",
});
// { queued: 12, skipped: 3, total: 15, format: "rss" }
```

---

### API Getting Started

The server exposes a REST API at `http://localhost:3000/api`. All routes require a Bearer token except `POST /api/auth/login`, `GET /health`, and the setup endpoints.

**1. Get an API key:**

Create one via the CLI or the Settings → API Keys page. The `admin create` command prints the default key on first run.

**2. Create a snapshot:**

```bash
curl -X POST http://localhost:3000/api/snapshots \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# HTTP 202 — { "id": 1, "url": "https://example.com", "status": "pending" }
```

**3. List snapshots:**

```bash
curl http://localhost:3000/api/snapshots \
  -H "Authorization: Bearer wf_your_api_key_here"
# { "items": [...], "total": 42, "page": 1, "limit": 20 }
```

**4. Search:**

```bash
curl "http://localhost:3000/api/snapshots?q=climate+change" \
  -H "Authorization: Bearer wf_your_api_key_here"
# [{ "id", "url", "snippet": "...climate <mark>change</mark>...", "rank" }]
```

**5. Download an archive file:**

```bash
# Available extractors: warc, pdf, screenshot, readability, dom-snapshot, singlefile, html, media, media-metadata
curl -O -J http://localhost:3000/api/snapshots/1/archives/screenshot/download \
  -H "Authorization: Bearer wf_your_api_key_here"
```

**6. Import from an RSS feed:**

```bash
curl -X POST http://localhost:3000/api/import \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/feed.xml", "format": "rss"}'
# HTTP 202 — { "queued": 12, "skipped": 3, "total": 15, "format": "rss" }
```

---

## Packages

| Package | Description |
|---------|-------------|
| `@webfrost/core` | Database, pipeline, extractors library |
| `@webfrost/cli` | `webfrost` CLI binary |
| `@webfrost/server` | Elysia HTTP server + React UI |
| `@webfrost/sdk` | TypeScript client for the server API |
| `@webfrost/ui` | React single-page app |

---

## CLI commands

```
webfrost --help, -h                        Show help and list all commands
webfrost --version, -v                     Show CLI version
webfrost --verbose                         Enable debug-level output (or set WEBFROST_LOG_LEVEL=debug)
webfrost --quiet                           Suppress info output — only warn/error messages shown
webfrost <command> --help                  Show help for a specific command (e.g. webfrost tag --help)

webfrost init                              Initialize a new archive at WEBFROST_DIR
webfrost add <url>                         Archive a URL (WARC + Readability + PDF + screenshot + DOM + SingleFile)
webfrost list                              List all snapshots
webfrost delete <id>                       Delete a snapshot and its archive files
webfrost search <query>                    Full-text search across archived content
webfrost search:rebuild                    Rebuild the full-text search index

webfrost tag add <snapshot-id> <name>      Add a tag to a snapshot (creates tag if needed)
webfrost tag list [<snapshot-id>]          List all tags, or tags on a specific snapshot
webfrost tag create <name> [--color <hex>] Create a new tag
webfrost tag remove <tag-id>              Delete a tag (removes from all snapshots)

webfrost schedule add <url> --cron <expr>          Add a recurring archive schedule
webfrost schedule add --rss <feed-url> --cron <expr>  Add a recurring RSS feed import schedule
webfrost schedule list                             List all schedules
webfrost schedule remove <id>                     Remove a schedule
webfrost schedule worker                           Run a background worker that polls and executes due schedules

webfrost import [--format <fmt>] <url-or-file>     Bulk import URLs from a plain-text, OPML, RSS feed,
                                                   or Netscape bookmark HTML file

webfrost admin create --username <n> --password <p>   Create admin user + default API key (run once)
webfrost admin key create --name <label>               Create an additional API key
webfrost admin key list                                List active API keys
webfrost admin key revoke <id>                         Revoke an API key
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Directory for the SQLite database and archive files |
| `SESSION_SECRET` | — | Required for the server. Random string ≥ 32 chars. |
| `AUTH_DISABLED` | `false` | Set to `true` to skip auth in dev. Never use in production. |
| `WEBFROST_CONCURRENCY` | `3` | Max number of archive pipelines running in parallel (import, schedule worker, server). |
| `WEBFROST_LOG_LEVEL` | `info` | CLI log verbosity: `debug`, `info`, `warn`, `error`. Overridden by `--verbose` / `--quiet`. |

See [docs/DEPLOY.md](docs/DEPLOY.md) for the full auth setup walkthrough.

---

## API

The server exposes a REST API alongside the React UI. All `/api/*` routes require authentication (Bearer token or session cookie) except `POST /api/auth/login`, `GET /health`, and the `/api/setup` routes.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check (unauthenticated) |
| `GET` | `/api/setup/status` | Check if first-run setup is needed (unauthenticated) |
| `POST` | `/api/setup` | Complete first-run setup — creates admin user (unauthenticated) |
| `POST` | `/api/auth/login` | Log in with `{username, password}` — sets session cookie |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET` | `/api/auth/me` | Returns current authenticated username |
| `POST` | `/api/auth/change-password` | Change the admin password |
| `POST` | `/api/snapshots` | Submit a URL for archiving (202 — async) |
| `GET` | `/api/snapshots` | List all snapshots (supports `?page=X&limit=Y`) |
| `GET` | `/api/snapshots?q=<term>` | Full-text search — returns ranked results with snippets |
| `GET` | `/api/snapshots/:id` | Get snapshot with archive results |
| `DELETE` | `/api/snapshots/:id` | Delete a snapshot and its archive files |
| `GET` | `/api/snapshots/:id/archives/:extractor/download` | Download archive file (`html`, `warc`, `pdf`, `readability`, `screenshot`, `dom-snapshot`, `singlefile`) |
| `GET` | `/api/snapshots/:id/tags` | List tags on a snapshot |
| `POST` | `/api/snapshots/:id/tags` | Add a tag to a snapshot |
| `DELETE` | `/api/snapshots/:id/tags/:tagId` | Remove a tag from a snapshot |
| `POST` | `/api/schedules` | Add a recurring archive schedule |
| `GET` | `/api/schedules` | List all schedules |
| `DELETE` | `/api/schedules/:id` | Remove a schedule |
| `GET` | `/api/tags` | List all tags |
| `POST` | `/api/tags` | Create a tag |
| `DELETE` | `/api/tags/:id` | Delete a tag |
| `POST` | `/api/import` | Bulk import from RSS, OPML, Netscape HTML, or text (202 — async) |
| `GET` | `/api/settings/info` | Get server info (version, storage path, snapshot count) |
| `GET` | `/api/settings/keys` | List API keys |
| `POST` | `/api/settings/keys` | Create an API key |
| `DELETE` | `/api/settings/keys/:id` | Revoke an API key |

**Search example:**

```bash
# CLI
webfrost search "climate change policy"

# HTTP API
curl -H "Authorization: Bearer <key>" \
  "http://localhost:3000/api/snapshots?q=climate+change"

# SDK
const results = await client.searchSnapshots("climate change");
// [{ id, url, snippet: "...climate <mark>change</mark>...", rank }]
```

---

## Development

```bash
bun install          # Install all workspace dependencies
bun run build        # Build all packages
bun run test         # Run tests
bun run lint         # Biome linting
bun run format       # Format code
bun run typecheck    # TypeScript type checking
bun run bench        # Benchmarks
```

**Running the CLI during development** (no rebuild needed — Bun runs TypeScript directly):

```bash
# Use the root package.json shortcut
WEBFROST_DIR=./data bun run webfrost add https://example.com
WEBFROST_DIR=./data bun run webfrost --help
```

Benchmark results and methodology: [BENCHMARKS.md](BENCHMARKS.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) if it exists, or open an issue with questions.

---

## Roadmap

WebFrost is under active development. See [ROADMAP.md](./ROADMAP.md) for the full feature roadmap and ArchiveBox comparison.

**Shipped in 0.1.0:**
- API authentication (bearer tokens + session cookies)
- Full-text search (SQLite FTS5)
- RSS feed auto-import (via `import` command and `/api/import`)
- Tags and snapshot deletion
- Screenshot (PNG), DOM snapshot, and SingleFile extractors
- Media extraction via yt-dlp (video/audio archival from YouTube, Vimeo, SoundCloud, etc.)
- Web UI with tag management, schedules, import, and settings pages
- First-run setup wizard

**Coming next:**
- Browser extension (Chrome/Firefox)
- S3/remote storage backend

---

## Releasing

See [docs/RELEASE.md](docs/RELEASE.md) for the full release process and [docs/VERSIONING.md](docs/VERSIONING.md) for the version bump policy.
