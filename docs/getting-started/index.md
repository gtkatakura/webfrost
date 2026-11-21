---
title: What is WebFrost?
description: Overview of WebFrost — the self-hosted web archiving toolkit.
---

# What is WebFrost?

WebFrost is a self-hosted web archiving toolkit. It takes a URL and saves it in six formats at once: WARC, Readability JSON, PDF, full-page screenshot, DOM snapshot, and self-contained HTML. Everything is stored in a directory you control — SQLite for metadata, plain files for archives.

## Why WebFrost?

### Fast by design

Most archivers run multiple browser sessions or make redundant HTTP requests — one per extractor. WebFrost launches **one browser session** per snapshot and runs all extractors in parallel against a **shared HTTP cache**. No duplicate requests. No wasted round trips.

### Open formats

- **WARC** is a standard archival format, readable by [ReplayWeb.page](https://replayweb.page/), the Wayback Machine, and other tools.
- **PDF, PNG, and HTML** need no special software.
- **SQLite** is readable with any SQLite client.

Nothing is proprietary. If WebFrost goes away, your archive stays.

### Self-hosted

No cloud account. No API keys. No subscription fees. Runs on your laptop, a Raspberry Pi, or a VPS. The entire archive is one directory — back it up with `rsync`.

## Packages

WebFrost is a monorepo with these packages (plus the React UI, `@webfrost/ui`, which the server serves):

| Package | Description |
|---|---|
| `@webfrost/core` | Database, pipeline, and extractors library |
| `@webfrost/cli` | `webfrost` CLI binary |
| `@webfrost/server` | Elysia HTTP server + React UI |
| `@webfrost/sdk` | TypeScript client for the server API |

## What gets captured?

For every URL you archive, WebFrost runs these extractors:

| Format | File | Description |
|---|---|---|
| WARC | `archive.warc` | Raw HTTP archive — all request/response pairs |
| Readability | JSON, in the database | Article text, title, and byline |
| PDF | `page.pdf` | Full-page PDF from the headless browser |
| Screenshot | `screenshot.png` | Full-page PNG |
| DOM snapshot | `dom.html` | Serialized DOM |
| SingleFile | `singlefile.html` | Offline HTML with all assets inlined |
| HTML | in the database | Raw HTML source |
| Media | `media/` | Video/audio via yt-dlp (if installed) |

## Next steps

- **Archive your first page** → [Quickstart](/getting-started/quickstart)
- **See all install options** → [Installation](/getting-started/install)
- **Run as a persistent server** → [Docker setup](/getting-started/docker)
