# WebFrost

A self-hosted web archiving toolkit. Archive URLs to WARC, Readability JSON, PDF, full-page screenshots, DOM snapshots, and self-contained HTML with one command.

One shared HTTP cache, one browser navigation per snapshot, durable open formats (files + SQLite), no lock-in.

---

## Quickstart

**Requirements:** [Bun](https://bun.sh) v1.x, Chromium (for PDF/screenshot extractors)

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
bun install

mkdir -p ./data
WEBFROST_DIR=./data bun run webfrost init
WEBFROST_DIR=./data bun run webfrost add https://example.com
WEBFROST_DIR=./data bun run webfrost list
```

Or run the server with UI:

```bash
bun run build
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
# Open http://localhost:3000
```

---

## Packages

| Package | Description |
|---|---|
| `@webfrost/core` | Database, pipeline, extractors library |
| `@webfrost/cli` | `webfrost` CLI binary |
| `@webfrost/server` | Elysia HTTP server + React UI |
| `@webfrost/sdk` | TypeScript client for the server API |
| `@webfrost/ui` | React single-page app |

---

## Documentation

Full documentation site: `bun run docs:dev` → `http://localhost:5173`

| Section | Contents |
|---|---|
| [Tutorials](docs/tutorials/first-archive.md) | Archive your first page end-to-end |
| [How-to: Bulk import](docs/how-to/bulk-import.md) | Import URLs from files, feeds, and bookmarks |
| [How-to: Scheduled archives](docs/how-to/scheduled-archives.md) | Set up recurring archive jobs |
| [How-to: Docker deploy](docs/how-to/docker-deploy.md) | Run as a persistent server with Docker |
| [How-to: S3 storage](docs/how-to/s3-storage.md) | Configure remote storage (coming soon) |
| [Reference: CLI](docs/reference/cli.md) | All CLI commands and flags |
| [Reference: REST API](docs/reference/rest-api.md) | All API endpoints |
| [Reference: SDK](docs/reference/sdk.md) | TypeScript client usage |
| [Reference: Environment variables](docs/reference/environment-variables.md) | All env vars |
| [Reference: Extractors](docs/reference/extractors.md) | WARC, PDF, screenshot, and more |
| [Explanation: Architecture](docs/explanation/architecture.md) | C4 diagrams — system, containers, components |
| [Explanation: Pipeline](docs/explanation/pipeline.md) | Sequence diagrams for archive, import, schedule flows |
| [Explanation: Storage model](docs/explanation/storage-model.md) | How archive files and SQLite are organized |
| [Deploy](docs/DEPLOY.md) | CI/CD pipeline and deployment targets |
| [Release](docs/RELEASE.md) | Release process |
| [Versioning](docs/VERSIONING.md) | Version bump policy |
| [Security](docs/SECURITY.md) | Security policy |

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

Run `make` (or `make help`) for the full list of contributor workflows.

Benchmark results: [BENCHMARKS.md](BENCHMARKS.md)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full feature roadmap.

**Shipped in 0.1.0:** API auth, full-text search, RSS import, tags, screenshots, DOM snapshots, SingleFile, media extraction via yt-dlp, web UI, first-run setup wizard.

**Coming next:** Browser extension, S3/remote storage backend.
