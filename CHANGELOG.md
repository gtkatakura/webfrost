# Changelog

Notable changes to WebFrost. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [SemVer](https://semver.org/), and while WebFrost is `0.x` a minor version can break the HTTP API,
the SDK or the on-disk layout (see [Releasing](apps/docs/content/docs/contributing/releasing.mdx)). Each
package also has its own changelog, generated from the changesets in [`.changeset`](.changeset).

## [Unreleased]: first public release (0.1.0)

Everything up to the first published version.

### Archiving

- Eight formats from one HTTP fetch and one browser navigation: WARC 1.1, raw HTML, readable text
  (Readability), PDF, full-page screenshot, DOM snapshot, self-contained HTML (SingleFile) and video or
  audio through yt-dlp. One extractor failing never fails the snapshot; each one records why it did not run.
- Full-text search (SQLite FTS5) over URLs, titles, extracted text and tag names, with highlighted snippets.
- Imports from plain URL lists, Netscape bookmarks, OPML and RSS/Atom feeds.
- Cron schedules for URLs and feeds, run by the server itself or by `webfrost schedule worker`.
- A job queue with a shared concurrency limit, retries after a crash, and a minimum gap between two
  archives of the same site (`WEBFROST_DOMAIN_DELAY_MS`).
- Archive files on the local filesystem or in S3-compatible storage (S3, MinIO, R2, B2).

### Surfaces

- `webfrost` CLI: `init`, `add`, `list`, `search`, `delete`, `import`, `tag`, `schedule`, `admin`.
- HTTP API (Elysia) and a TypeScript SDK (`@webfrost/sdk`).
- Web UI: dashboard, snapshot list with a detail panel and sandboxed previews, search, tags, schedules,
  imports, API keys, light and dark themes, command palette and keyboard shortcuts.
- Docker image with Chromium, yt-dlp and ffmpeg, and a Compose file for production.

### Security

- API keys (stored hashed) and server-side sessions, revoked on logout and on password change.
- Login and API rate limits; `X-Forwarded-For` trusted only with `WEBFROST_TRUST_PROXY`.
- Read-only public mode (`WEBFROST_PUBLIC_READ`): visitors browse and search, only signed-in users change
  anything.
- SSRF guard on every fetch, every redirect hop and every request the headless browser makes.
- Archived pages are previewed in a sandbox (CSP `sandbox`, no scripts, opaque origin).

### Fixed

- Bun upgraded to 1.4.4: Bun 1.3 closed already-closed file descriptors of child processes, which could
  close the archive database's files after the browser exited (`SQLITE_IOERR`).
