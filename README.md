<p align="center">
  <a href="https://webfrost.dev"><img src=".github/assets/banner.webp" width="720" alt="WebFrost: an arctic fox asleep on a frozen archive box, with the formats it keeps around it"></a>
</p>

# WebFrost

A self-hosted web archiving toolkit. Archive URLs to WARC, Readability JSON, PDF, full-page screenshots, DOM snapshots, self-contained HTML and media with one command.

One shared HTTP cache, one browser navigation per snapshot, durable open formats (files + SQLite), no lock-in.

---

## Quickstart

### Docker (server + web UI + scheduler)

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.prod.yml up -d
# Open http://localhost:3000 and create the admin user
```

The image bundles Chromium, yt-dlp and ffmpeg, so every extractor works out of the box.
See [How-to: Docker deploy](apps/docs/content/docs/guides/deploy.mdx).

### From source

**Requirements:** [Bun](https://bun.sh) v1.x. Optional but recommended: Chromium (PDF, screenshot, DOM snapshot, SingleFile) and `yt-dlp` + `ffmpeg` (media). Without Chromium the browser extractors are recorded as failed on each snapshot; without yt-dlp media extraction is skipped. Everything else still runs.

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
bun install
bunx playwright install chromium   # or: export WEBFROST_CHROMIUM_PATH=/usr/bin/chromium
```

---

## Getting started

WebFrost has four surfaces over the same archive directory (`WEBFROST_DIR`).

### CLI

```bash
export WEBFROST_DIR=./data && mkdir -p "$WEBFROST_DIR"

bun run webfrost init
bun run webfrost add https://example.com
bun run webfrost list
bun run webfrost search "example domain"

bun run webfrost import bookmarks.html                 # Netscape, OPML, RSS/Atom or plain text
bun run webfrost schedule add https://example.com --cron "0 * * * *"
bun run webfrost schedule worker                       # runs due schedules (the server does this itself)
bun run webfrost --help
```

Full reference: [reference/cli.mdx](apps/docs/content/docs/reference/cli.mdx).

### Server API

```bash
bun run build
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data bun run packages/server/src/index.ts
```

Create the admin user in the browser (first visit) or with
`bun run webfrost admin create --username admin --password <password>`, which also prints an API key.

```bash
API=http://localhost:3000/api
KEY=<your-api-key>

# Queue an archive (202 Accepted; the pipeline runs in the background)
curl -X POST "$API/snapshots" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"url":"https://example.com"}'

curl "$API/snapshots?page=1&limit=20&status=done" -H "Authorization: Bearer $KEY"
curl "$API/snapshots?q=example" -H "Authorization: Bearer $KEY"          # full-text search
curl "$API/snapshots/1" -H "Authorization: Bearer $KEY"                   # detail + per-extractor status
curl -OJ "$API/snapshots/1/archives/pdf/download" -H "Authorization: Bearer $KEY"
```

| Route | Purpose |
|---|---|
| `POST /api/setup`, `GET /api/setup/status` | First-run admin creation |
| `POST /api/auth/login` · `logout` · `change-password`, `GET /api/auth/me` | Session auth |
| `GET/POST /api/snapshots`, `GET/DELETE /api/snapshots/:id` | List (newest first), search (`?q=`), create, inspect, delete |
| `GET /api/snapshots/:id/archives/:extractor/download` | Download one archived format |
| `GET /api/snapshots/:id/archives/:extractor/preview` | Sandboxed HTML preview (`dom-snapshot`, `singlefile`) |
| `GET/POST /api/tags`, `DELETE /api/tags/:id`, `GET/POST/DELETE /api/snapshots/:id/tags` | Tags |
| `GET/POST /api/schedules`, `GET/PATCH/DELETE /api/schedules/:id` | Cron schedules (pause/resume via `PATCH`) |
| `POST /api/import`, `POST /api/import/file`, `GET /api/imports` | Bulk import and import history |
| `GET /api/stats`, `GET /api/settings/info`, `GET/POST/DELETE /api/settings/keys` | Stats, version, API keys |
| `GET /health` | Unauthenticated health check |

Full reference: [reference/rest-api.mdx](apps/docs/content/docs/reference/rest-api.mdx).

### SDK

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000/api", // include the /api prefix
  apiKey: process.env.WEBFROST_API_KEY,
});

const { id } = await client.createSnapshot("https://example.com");
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });
const hits = await client.searchSnapshotsPage("example", { page: 1 });
```

Full reference: [reference/sdk.mdx](apps/docs/content/docs/reference/sdk.mdx). The package is not on npm yet; use it from this workspace.

### Web UI

The server serves a React SPA at `http://localhost:3000`. Key features:

- **Dashboard** — stats cards, Quick Archive form, recent activity feed
- **Snapshots** — virtualized list, density toggle, inline filtering, bulk delete, slide-over detail panel with per-extractor status and a sandboxed preview of the archived page
- **Search** — SQLite FTS5 full-text search with highlighted snippets, pagination and saved searches
- **Schedules** — cron-based scheduling with health badges (On schedule / Overdue / Paused); run by the server itself
- **Tags** — color-coded tag management; tag names are searchable
- **Import** — RSS, OPML, Netscape bookmarks, plain-text URL list
- **Light/dark theme** — follows system preference, persisted to `localStorage`
- **Keyboard shortcuts** — `⌘K` search palette, `?` shortcut help, `g h/s/t/i` navigation
- **Collapsible sidebar** — 240 px expanded, 56 px icon-only; state persisted
- **Read-only guest view** — with `WEBFROST_PUBLIC_READ=true`, visitors can browse and search without an account; every control that changes something is shown only after signing in

Stack: React 18, React Router v6, Tailwind CSS v4 (CSS variable design system), `@tanstack/react-query`, `@tanstack/react-virtual`, `lucide-react`, `sonner`.

See [Web UI guide](apps/docs/content/docs/guides/web-ui.mdx) for full documentation.

---

## Configuration

The variables you are most likely to need. Everything else is in [Reference: Environment variables](apps/docs/content/docs/reference/configuration.mdx) and `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `WEBFROST_DIR` | cwd (CLI) / `~/.webfrost` (server) / `/data` (Docker) | Archive directory: `archive.db` + `snapshots/` |
| `SESSION_SECRET` | — (required by the server) | Signs session cookies; ≥ 32 random characters |
| `PORT` | `3000` | Server port |
| `WEBFROST_CONCURRENCY` | `3` | Archive pipelines run in parallel |
| `WEBFROST_DOMAIN_DELAY_MS` | `1000` | Minimum gap between two archives of the same host |
| `WEBFROST_SCHEDULER` | `true` | Set `false` to stop the server from running schedules |
| `WEBFROST_TRUST_PROXY` | `false` | Honour `X-Forwarded-For` (only behind a reverse proxy) |
| `WEBFROST_PUBLIC_READ` | `false` | Let anonymous visitors browse the archive (read-only); writes still need a login |
| `WEBFROST_INSECURE_COOKIES` | `false` | Allow session cookies over plain HTTP on a non-localhost address |
| `WEBFROST_ALLOW_PRIVATE_URLS` | `false` | Allow archiving private/loopback addresses |
| `WEBFROST_CHROMIUM_PATH` | — | Use an existing Chromium instead of Playwright's download |
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3` (plus the `S3_*` variables) |
| `WEBFROST_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TZ` | system | Time zone used to evaluate cron expressions |

---

## Packages

| Package | Description |
|---|---|
| `@webfrost/core` | Database, pipeline, extractors, job runner, scheduler, storage backends |
| `@webfrost/cli` | `webfrost` CLI binary |
| `@webfrost/server` | Elysia HTTP server + React UI + embedded scheduler |
| `@webfrost/sdk` | TypeScript client for the server API |
| `@webfrost/ui` | React single-page app |
| `@webfrost/docs` | This documentation site (`apps/docs`) |

---

## Documentation

The documentation is a site in [`apps/docs`](apps/docs) (React Router + Vite + Fumadocs, every page prerendered). Run it with `bun run docs:dev` → `http://localhost:5174`. The pages are MDX files you can also read on GitHub:

| Section | Contents |
|---|---|
| [Getting started](apps/docs/content/docs/getting-started/quickstart.mdx) | Quickstart with Docker, install from source, archive your first page |
| [Guides](apps/docs/content/docs/guides) | Web UI, bulk import, schedules, public read, storage, production deploy, troubleshooting |
| [Reference](apps/docs/content/docs/reference) | CLI, REST API, SDK, configuration, extractors, database, disk layout |
| [Architecture](apps/docs/content/docs/architecture) | Overview, pipeline, storage model, security, threat model |
| [Contributing](apps/docs/content/docs/contributing) | Development setup, project structure, releasing |

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

Run `mise tasks` for every contributor workflow (`mise run <task>`), and see [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Benchmark results: [BENCHMARKS.md](BENCHMARKS.md)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full feature roadmap.

**Shipped in 0.1.0:** API auth, full-text search, RSS import, tags, screenshots, DOM snapshots, SingleFile, media extraction via yt-dlp, web UI, first-run setup wizard.

**Shipped in 0.2.0 (UI):** Redesigned React UI — light/dark theme, command palette, keyboard shortcuts, virtualized snapshot list, bulk delete, schedule health tracking, import history, API key management.

**Unreleased (hardening):** scheduler embedded in the server, bounded job runner with crash recovery, public-read/private-write mode, per-domain rate limiting, extractor timeouts, SSRF guard extended to the headless browser, revocable sessions, login rate limiting, Docker image with Chromium and yt-dlp.

**Coming next:** Browser extension, webhooks, OpenAPI docs, npm packages.

---

## License

[MIT](LICENSE)
