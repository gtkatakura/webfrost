---
title: Roadmap
description: What's shipped and what's coming next in WebFrost.
---

# Roadmap

WebFrost is compared against [ArchiveBox](https://archivebox.io/) as the reference point for a mature self-hosted web archiver. The roadmap is prioritized by user impact.

## What shipped in 0.1.0

- API authentication (session + API keys)
- Full-text search (SQLite FTS5)
- RSS feed import and scheduling
- Tags with colors
- Screenshots and DOM snapshots
- SingleFile (self-contained offline HTML)
- Media extraction via yt-dlp (YouTube, Vimeo, etc.)
- React web UI with first-run setup wizard
- `@webfrost/sdk` TypeScript client
- S3-compatible storage backend

## Current priorities

| Priority | Feature |
|---|---|
| P0 | Browser extension for one-click archiving |
| P0 | Multi-user support |
| P1 | Full-page replay (Browsertrix integration or WACZ output) |
| P1 | Webhook triggers — archive on RSS item, GitHub event, etc. |
| P1 | Export/download entire archive as ZIP or WACZ |
| P2 | Server Content-Security-Policy hardening |
| P2 | OPDS catalog support |
| P2 | Annotation and highlighting on archived pages |

## Full roadmap

See `ROADMAP.md` in the repo root for the full feature comparison against ArchiveBox and detailed priority breakdown.

## Contributing

The best way to contribute is to:

1. Open an issue describing the feature or bug.
2. Check the roadmap and existing issues for duplicates.
3. If it's a new feature, discuss the approach before opening a PR.
4. Follow the [development setup](/contributing/development) guide.

Docs improvements are always welcome — open a PR against `docs/` directly.
