---
title: Bulk import
description: Import URLs from text files, RSS feeds, OPML, and browser bookmark files.
---

# Bulk import

Import large collections of URLs in one command. WebFrost supports plain text, RSS feeds, OPML subscription lists, and Netscape bookmark HTML files.

## Plain text

Create a file with one URL per line:

```
https://example.com
https://news.ycombinator.com
https://lobste.rs
```

```bash
WEBFROST_DIR=./data webfrost import urls.txt
```

## Browser bookmarks (Netscape HTML)

Export bookmarks from Chrome, Firefox, or Safari — all use the same Netscape HTML format:

```bash
WEBFROST_DIR=./data webfrost import bookmarks.html
```

WebFrost parses all `<A HREF=...>` entries and enqueues them.

## OPML feed list

Export your RSS reader subscriptions as OPML and import all feed items:

```bash
WEBFROST_DIR=./data webfrost import subscriptions.opml
```

Each feed in the OPML is fetched and all items are enqueued.

## RSS feed URL

```bash
WEBFROST_DIR=./data webfrost import --format=rss https://example.com/feed.xml
```

## Via the REST API

```bash
curl -X POST http://localhost:3000/api/import \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/feed.xml", "format": "rss"}'
# HTTP 202 — { "queued": 12, "skipped": 3, "total": 15, "format": "rss" }
```

## Via the SDK

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss",
});
```

## Concurrency

By default, up to 3 archive pipelines run in parallel. Adjust with `WEBFROST_CONCURRENCY`:

```bash
WEBFROST_CONCURRENCY=5 WEBFROST_DIR=./data webfrost import urls.txt
```

## Deduplication

RSS imports skip URLs that already have a snapshot and count them as `skipped` in the result, so re-importing the same feed only archives new items. Every import is also recorded in the `imports` history table.
