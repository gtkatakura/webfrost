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

# Archive a URL
WEBFROST_DIR=./data bun run packages/cli/src/index.ts add https://example.com

# List snapshots
WEBFROST_DIR=./data bun run packages/cli/src/index.ts list
```

Or run the server with UI:

```bash
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

webfrost import <file>                     Bulk import URLs from a plain-text, OPML, or
                                           Netscape bookmark HTML file
```

**Environment variable:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBFROST_DIR` | `~/.webfrost` | Directory for the SQLite database and archive files |

---

## API

The server exposes a REST API alongside the React UI:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/snapshots` | Submit a URL for archiving |
| `GET` | `/api/snapshots` | List all snapshots |
| `GET` | `/api/snapshots/:id` | Get snapshot with archive results |
| `GET` | `/api/snapshots/:id/archives/:extractor/download` | Download archive file (`warc`, `pdf`, `readability`) |
| `POST` | `/api/schedules` | Add a recurring schedule |
| `GET` | `/api/schedules` | List all schedules |
| `DELETE` | `/api/schedules/:id` | Remove a schedule |

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

See [CONTRIBUTING.md](CONTRIBUTING.md) if it exists, or open an issue with questions.

---

## Releasing

See [docs/RELEASE.md](docs/RELEASE.md) for the full release process and [docs/VERSIONING.md](docs/VERSIONING.md) for the version bump policy.
