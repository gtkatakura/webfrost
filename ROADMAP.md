# Roadmap

Where WebFrost is going. It changes as people use it: if something here matters to you, or something
missing does, say so in [Discussions](https://github.com/gtkatakura/webfrost/discussions) or upvote the
issue.

WebFrost is `0.x`: the HTTP API, the SDK and the on-disk layout can still change between minor versions.
Every breaking change is called out in the [changelog](CHANGELOG.md).

## Now: first public release (0.1.0)

- **Easy to install anywhere.** A Docker image for amd64 and arm64 (Apple Silicon, Raspberry Pi, ARM
  NAS), and a single `webfrost` binary for macOS, Linux and Windows with `webfrost serve`, `setup` and
  `doctor`, installable with a script or Homebrew.
- **Hardening.** CSRF protection for browser sessions, safer media downloads (yt-dlp), valid WARC files
  for compressed and binary responses, a non-root container, request size limits, graceful shutdown.
- **Your choice of database.** SQLite stays the default for one person on one machine, with a guide
  and an optional Compose service for continuous backups with Litestream. PostgreSQL and MySQL are
  supported through `DATABASE_URL`, with full-text search on each, for teams and for running several
  WebFrost servers against one database.

## Next

- **Browser extension** for Chrome and Firefox: archive the page you are on in one click.
- **Webhooks** when a snapshot finishes or fails.
- **OpenAPI description** of the HTTP API, with interactive docs.
- **Archiving pages behind a login**, from a cookies file or a browser profile.
- **Search filters on the server** (status, date range, tags), not only on the current page.
- **Export** of an archive or a selection as zip or WACZ.
- **More imports:** browser history, Pocket and Pinboard exports.
- **Filtering egress proxy** that pins the checked IP for every request the browser and yt-dlp make,
  closing DNS rebinding and redirect-based SSRF for good.

## Later

- An extractor API, so new formats can be added without forking.
- Single sign-on (OpenID Connect).
- Several users with their own archives.
- Kubernetes manifests and a Helm chart.
- Search by meaning, not only by keywords.

## Already there

Eight formats from one visit (WARC, raw HTML, readable text, PDF, full-page screenshot, DOM snapshot,
self-contained HTML, video); full-text search; tags; imports from bookmarks, OPML, RSS/Atom and URL
lists; cron and feed schedules run by the server; a job queue with crash recovery and per-site pacing;
filesystem or S3-compatible storage; API keys, revocable sessions and rate limits; read-only public mode;
an SSRF guard for fetches and the headless browser; CLI, a versioned HTTP API (`/api/v1`, one error format,
one pagination format) with a TypeScript SDK, and a web UI with the
WebFrost look in light and dark, clear error states, accessible dialogs and a phone layout; optional
OpenTelemetry traces, metrics and logs, sent only to a collector you configure.

## Contributing

Issues labelled [good first issue](https://github.com/gtkatakura/webfrost/labels/good%20first%20issue)
are a good place to start. See [CONTRIBUTING.md](CONTRIBUTING.md).
