# WebFrost Roadmap

WebFrost is the fastest practical self-hosted web archiver — one shared HTTP cache, one browser navigation per snapshot, durable open formats (files + SQLite), no lock-in.

This roadmap is prioritized by user impact. Items are compared against [ArchiveBox](https://archivebox.io/), the most mature open-source web archiver, to show where WebFrost is heading.

## Legend

| Symbol | Meaning |
|--------|----------|
| ✅ | Already shipped |
| 🔴 P0 | Critical — blocks adoption |
| 🟠 P1 | High value — major capability gap |
| 🟡 P2 | Medium value — meaningful improvement |
| ⚪ P3 | Long-term / ambitious |
| AB | ArchiveBox has this feature |
| WF | WebFrost has this feature |

---

## Feature Comparison: ArchiveBox vs WebFrost

### Archive Formats

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Raw HTML | ✅ | ✅ | — |
| WARC 1.1 | ✅ | ✅ | — |
| Readability (article extract) | ✅ | ✅ | — |
| PDF snapshot | ✅ | ✅ | — |
| Screenshot (PNG) | ✅ | ✅ | — |
| SingleFile (self-contained HTML) | ✅ | ✅ | — |
| DOM snapshot | ✅ | ✅ | — |
| Media extraction (video/audio via yt-dlp) | ✅ | ❌ | 🟠 P1 |
| Git repo clone | ✅ | ❌ | ⚪ P3 |
| WACZ (Web Archive Collection Zipped) | ❌ | ❌ | ⚪ P3 |

### Input Methods

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Single URL via CLI | ✅ | ✅ | — |
| Bulk text file import (one URL per line) | ✅ | ✅ | — |
| Netscape HTML bookmarks import | ✅ | ✅ | — |
| OPML import | ✅ | ✅ | — |
| HTTP API | ✅ | ✅ | — |
| Cron-based scheduling | ✅ | ✅ | — |
| RSS feed auto-import (subscribe + poll) | ✅ | ✅ | — |
| Browser extension (Chrome/Firefox) | ✅ | ❌ | 🟠 P1 |
| Browser history import | ✅ | ❌ | 🟡 P2 |
| Pocket export import | ✅ | ❌ | 🟡 P2 |
| Pinboard export import | ✅ | ❌ | 🟡 P2 |
| MITM proxy capture | ✅ | ❌ | ⚪ P3 |
| Safari Shortcut | ✅ | ❌ | ⚪ P3 |

### Search and Discovery

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| URL/metadata filtering | ✅ | ✅ (client-side) | — |
| Full-text search (SQLite FTS5) | ✅ | ✅ | — |
| Tag-based filtering | ✅ | ✅ | — |
| Full-text search (Sonic backend) | ✅ | ❌ | 🟠 P1 |
| Date/time range filtering | ✅ | ❌ | 🟡 P2 |
| Server-side pagination | partial | ✅ | — |

### Storage and Data

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| SQLite + filesystem | ✅ | ✅ | — |
| WAL mode for concurrent reads | ✅ | ✅ | — |
| Snapshot deletion | ❌ | ✅ | — |
| S3/object storage backend | ✅ | ❌ | 🟠 P1 |
| Backblaze B2 / Cloudflare R2 | ✅ | ❌ | 🟠 P1 |
| Archive export (zip/tar) | partial | ❌ | 🟡 P2 |
| NFS/SFTP remote filesystem | ✅ | ❌ | ⚪ P3 |

### Authentication and Access Control

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Bearer token API authentication | ✅ | ✅ | — |
| Session/cookie auth | ✅ | ✅ | — |
| Public read / private write | ✅ | ❌ | 🔴 P0 |
| Reverse proxy auth integration | ✅ | ✅ (by design) | — |
| SAML / OAuth / OpenID | ✅ | ❌ | 🟡 P2 |
| LDAP | ✅ (addon) | ❌ | ⚪ P3 |
| Multi-user / per-user archives | ❌ (paid) | ❌ | ⚪ P3 |

### API and Integrations

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| REST API for snapshots | ✅ | ✅ | — |
| REST API for schedules | ✅ | ✅ | — |
| SDK (programmatic use) | partial | ✅ | — |
| Webhook notifications | ✅ | ❌ | 🟠 P1 |
| OpenAPI / interactive docs | ✅ | ❌ | 🟠 P1 |
| Rate limiting (per-domain) | ❌ | ❌ | 🔴 P0 |
| Concurrency limit for import/schedule pipelines (`WEBFROST_CONCURRENCY`) | ❌ | ✅ | — |
| API pagination (server-side) | ✅ | ✅ | — |

### UI and UX

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Web UI (snapshot list + detail) | ✅ | ✅ | — |
| CLI | ✅ | ✅ | — |
| Tag management UI | ✅ | ✅ | — |
| Structured CLI logging (`--verbose`, `--quiet`, `WEBFROST_LOG_LEVEL`) | ✅ | ✅ | — |
| Batch operations (delete/retag) | ✅ | ❌ | 🟡 P2 |
| Desktop app | ✅ | ❌ | ⚪ P3 |
| Dark mode | partial | ❌ | 🟡 P2 |

### Deployment

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Docker / Docker Compose | ✅ | ✅ | — |
| GHCR image publishing via CI | ❌ | ✅ | — |
| Semantic versioning + Changesets | ❌ | ✅ | — |
| npm/bun package install | ✅ | ❌ | 🟠 P1 |
| Bare metal (pip/apt/brew equivalent) | ✅ | ❌ | 🟡 P2 |
| Kubernetes manifests | ❌ | ❌ | 🟡 P2 |

### Extensibility

| Feature | AB | WF | Priority |
|---------|----|----|----------|
| Custom extractor SDK | partial | ❌ | 🟠 P1 |
| Plugin system | ❌ | ❌ | ⚪ P3 |
| Third-party extractor registry | ❌ | ❌ | ⚪ P3 |

---

## Roadmap by Priority Tier

### 🔴 P0 — Critical (blocks adoption)

| Feature | Why it matters | Complexity | AB has it |
|---------|----------------|------------|-----------|
| **Public read / private write** | Expose UI safely without leaking write capability | S | ✅ |
| **Per-domain rate limiting** | Polite crawling; prevents target server bans | S | partial |

### 🟠 P1 — High Value (major capability gaps)

| Feature | Why it matters | Complexity | AB has it |
|---------|----------------|------------|-----------|
| **Media extraction** (yt-dlp) | Video/audio preservation; YouTube links rot | M | ✅ |
| **Browser extension** (Chrome + Firefox) | One-click archiving from browser; major UX unlock | L | ✅ |
| **S3/object storage backend** | Scale archive beyond local disk; cloud-native deployments | L | ✅ |
| **Webhook notifications** | Automation pipelines and integrations | S | ✅ |
| **OpenAPI / Swagger docs** | Developer experience; SDK generation | S | ✅ |
| **Custom extractor SDK** | Community can add formats without forking | L | partial |
| **Full-text search (Sonic backend)** | Scale FTS beyond SQLite; recommended for large archives | L | ✅ |
| **npm/bun package publish** | `bun add @webfrost/core` should work; unlocks SDK adoption | S | N/A |

### 🟡 P2 — Medium Value (meaningful improvements)

| Feature | Why it matters | Complexity | AB has it |
|---------|----------------|------------|-----------|
| **Browser history import** | Bulk-archive existing browsing history | S | ✅ |
| **Pocket export import** | Common migration path from Pocket | S | ✅ |
| **Pinboard export import** | Migration from Pinboard | S | ✅ |
| **Date/time range filtering** | Search snapshots within a time window | S | ✅ |
| **Archive export (zip/tar)** | Portable data migration and backup | M | partial |
| **Extractor timeouts** | Prevent hung Chromium from blocking pipelines | S | ✅ |
| **Concurrent schedule dedup** | Prevent overlapping runs when interval < execution time | S | ✅ |
| **Cron timezone support** | Users expect local-time scheduling | S | partial |
| **SAML / OAuth / OIDC** | Enterprise SSO integration | L | ✅ |
| **Batch operations UI** | Delete/re-archive/tag in bulk | M | ✅ |
| **Dark mode** | UX quality of life | S | partial |
| **Kubernetes manifests** | Formal k8s deployment support | M | ❌ |
| **Bare metal install** | `bun install -g @webfrost/cli` should work globally | S | ✅ |

### ⚪ P3 — Long-Term / Ambitious

| Feature | Why it matters | Complexity | AB has it |
|---------|----------------|------------|-----------|
| **WACZ format support** | Interoperability with Webrecorder ecosystem | XL | ❌ |
| **Git repo clone extractor** | Archive entire repos at a point in time | M | ✅ |
| **MITM proxy capture** | Capture any browsing session transparently | XL | ✅ |
| **Plugin/extractor registry** | Community ecosystem; third-party format support | XL | ❌ |
| **Multi-user / per-user archives** | SaaS-style hosted deployment | XL | ❌ (paid) |
| **AI-powered semantic search** | Find pages by meaning, not just keywords | XL | ❌ |
| **Desktop app** | Native GUI for non-technical users | XL | ✅ |
| **Federation / multi-instance sync** | Distributed archive mesh | XL | ❌ |
| **LDAP integration** | Enterprise directory auth | L | ✅ (addon) |
| **Safari extension** | iOS/macOS one-click archiving | L | partial |

---

## What WebFrost Does Better Than ArchiveBox

- **SDK-first design**: `@webfrost/core` is a proper importable TypeScript library. ArchiveBox's Python API is a bolted-on beta.
- **Single navigation, shared cache**: One `page.goto()` + one HTTP fetch feeds all extractors. ArchiveBox re-fetches per extractor.
- **Modern stack**: TypeScript + Bun + Elysia vs Python + Django. Faster cold starts, easier embedding.
- **CI/CD pipeline**: GHCR publishing, Changesets-based versioning, lefthook pre-commit hooks — production-grade from day one.
- **Open formats by default**: No proprietary index or database migrations between versions.
- **Honest partial-failure model**: One extractor failing never fails the snapshot.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.
P0 and P1 items are the best place to start — check the [issue tracker](https://github.com/gtkatakura/webfrost/issues) for open tasks.
