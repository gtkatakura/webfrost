# How-to: Bulk Import URLs

Import a large collection of URLs from a file or feed in one command.

---

## From a plain-text file

Create a file with one URL per line:

```
https://example.com
https://news.ycombinator.com
https://lobste.rs
```

Then import:

```bash
WEBFROST_DIR=./data webfrost import urls.txt
```

---

## From a Netscape bookmark HTML file

Export bookmarks from your browser (Chrome, Firefox, Safari all use this format) and import the file directly:

```bash
WEBFROST_DIR=./data webfrost import bookmarks.html
```

WebFrost parses all `<A HREF=...>` entries and enqueues them.

---

## From an OPML feed list

Podcast apps and RSS readers export subscriptions as OPML:

```bash
WEBFROST_DIR=./data webfrost import subscriptions.opml
```

Each feed URL in the OPML is fetched and all feed items are enqueued.

---

## From an RSS feed URL

Pass a feed URL directly with `--format=rss`:

```bash
WEBFROST_DIR=./data webfrost import --format=rss https://example.com/feed.xml
```

WebFrost fetches the feed, parses all items, and enqueues each item URL.

---

## Via the REST API

```bash
curl -X POST http://localhost:3000/api/import \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/feed.xml", "format": "rss"}'
# HTTP 202 — { "queued": 12, "skipped": 3, "total": 15, "format": "rss" }
```

Supported `format` values: `rss`, `opml`, `netscape`, `text`.

---

## Via the SDK

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss",
});
// { queued: 12, skipped: 3, total: 15, format: "rss" }
```

---

## Controlling concurrency

By default WebFrost runs up to 3 pipelines in parallel. Raise or lower this with:

```bash
WEBFROST_CONCURRENCY=5 WEBFROST_DIR=./data webfrost import urls.txt
```

See [Reference: Environment variables](../reference/environment-variables.md) for all options.
