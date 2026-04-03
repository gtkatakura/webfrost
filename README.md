# WebFrost

A self-hosted web archiving toolkit. Archive URLs to WARC, Readability JSON, and PDF with one command. One shared HTTP cache, one browser navigation per snapshot, durable open formats (files + SQLite), no lock-in.

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
WEBFROST_DIR=./data bun run packages/cli/src/index.ts init

# Archive a URL
WEBFROST_DIR=./data bun run packages/cli/src/index.ts add https://example.com

# List snapshots
WEBFROST_DIR=./data bun run packages/cli/src/index.ts list
```

Or run the server with UI:

```bash
mkdir -p ./data
WEBFROST_DIR=./data bun run packages/server/src/index.ts
# Open http://localhost:3000
```

---

## Docker (production)

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -v /path/to/local/data:/data \
  ghcr.io/<org>/webfrost/server:latest
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for full deployment instructions, env vars, and Docker Compose setup.

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
webfrost init                              Initialize a new archive at WEBFROST_DIR
webfrost add <url>                         Archive a URL (WARC + Readability + PDF)
webfrost list                              List all snapshots

webfrost schedule add <url> --cron <expr>  Add a recurring archive schedule
webfrost schedule list                     List all schedules
webfrost schedule remove <id>             Remove a schedule
webfrost schedule worker                   Run a background worker that polls and executes due schedules

webfrost import <file>                     Bulk import URLs from a plain-text, OPML, or
                                           Netscape bookmark HTML file
```

**Environment variable:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Directory for the SQLite database and archive files |

---

## API

The server exposes a REST API alongside the React UI:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/snapshots` | Submit a URL for archiving (202 — async) |
| `GET` | `/api/snapshots` | List all snapshots |
| `GET` | `/api/snapshots/:id` | Get snapshot with archive results |
| `GET` | `/api/snapshots/:id/archives/:extractor/download` | Download archive file (`html`, `warc`, `pdf`, `readability`) |
| `GET` | `/api/snapshots/:id/tags` | List tags on a snapshot |
| `POST` | `/api/snapshots/:id/tags` | Add a tag to a snapshot |
| `DELETE` | `/api/snapshots/:id/tags/:tagId` | Remove a tag from a snapshot |
| `POST` | `/api/schedules` | Add a recurring archive schedule |
| `GET` | `/api/schedules` | List all schedules |
| `DELETE` | `/api/schedules/:id` | Remove a schedule |
| `GET` | `/api/tags` | List all tags |
| `POST` | `/api/tags` | Create a tag |
| `DELETE` | `/api/tags/:id` | Delete a tag |

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

Benchmark results and methodology: [BENCHMARKS.md](BENCHMARKS.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) if it exists, or open an issue with questions.

---

## Roadmap

WebFrost is under active development. See [ROADMAP.md](./ROADMAP.md) for the full feature roadmap and ArchiveBox comparison.

**Near-term highlights (P0/P1):**
- API authentication (bearer tokens + session cookies)
- Full-text search (SQLite FTS5)
- Screenshot extractor (full-page PNG)
- DOM snapshot extractor
- SingleFile extractor (self-contained HTML)
- Snapshot deletion
- RSS feed auto-import
- Media extraction via yt-dlp
- Browser extension (Chrome/Firefox)
- S3/remote storage backend

---

## Releasing

See [docs/RELEASE.md](docs/RELEASE.md) for the full release process and [docs/VERSIONING.md](docs/VERSIONING.md) for the version bump policy.
