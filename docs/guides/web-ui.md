---
title: Web UI
description: Using the WebFrost web interface — browsing, searching, and managing snapshots.
---

# Web UI

The `@webfrost/server` package serves a React UI alongside the REST API at `http://localhost:3000`.

## Start the server

**From source:**

```bash
bun run build   # Build UI assets (required once)
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
```

**With Docker:**

See [Docker setup](/getting-started/docker).

## First-run setup

On first visit, WebFrost shows a setup wizard to create your admin account. After that, log in with your username and password.

## Archiving from the UI

Use the archive input at the top of the page to submit a URL. The request is sent to `POST /api/snapshots` and processed asynchronously. The snapshot appears in the list as it completes.

## Browsing snapshots

The snapshot list shows URL, capture date, and status. Click a snapshot to see the extractor results and download links for each format: WARC, PDF, PNG, Readability JSON, DOM snapshot, SingleFile HTML, and media files.

## Searching

The search bar queries the SQLite FTS5 index and returns ranked results with matched snippets.

## Managing tags

Create tags with custom names and hex colors from **Settings → Tags**. Add or remove tags on individual snapshots from the snapshot detail view.

## Scheduled archives

Create and manage schedules from **Settings → Schedules**. Each schedule shows its cron expression, last-run status, and consecutive failure count. Schedules can be paused and resumed.

## API keys

Create and revoke API keys from **Settings → API Keys**. API keys are used with the REST API and SDK.

## Importing URLs

Submit a bulk import from the UI import panel. Supported formats: RSS feed URL, OPML file, Netscape bookmark HTML, plain text.
