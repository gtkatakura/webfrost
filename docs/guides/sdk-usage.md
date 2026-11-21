---
title: SDK usage
description: Programmatic usage of WebFrost with the @webfrost/sdk TypeScript client.
---

# SDK usage

`@webfrost/sdk` is a typed TypeScript client for the WebFrost server API.

## Install

```bash
bun add @webfrost/sdk
# or
npm install @webfrost/sdk
```

## Create a client

```typescript
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000/api",
  apiKey: "wf_your_api_key_here",
});
```

`baseUrl` must include the `/api` prefix (the client appends paths such as `/snapshots` to it), so a server on port 3000 is `http://localhost:3000/api`.

## Archive a URL

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending" }
```

The server processes the archive asynchronously. Poll `getSnapshot` until `status` is no longer `pending`: it becomes `done` (at least one extractor produced output) or `failed`.

## List and search snapshots

```typescript
// List with pagination
const { items, total, page, limit } = await client.listSnapshots({ page: 1, limit: 20 });

// Full-text search
const results = await client.searchSnapshots("climate change policy");
// [{ id, url, snippet: "...climate <mark>change</mark>...", rank, status, createdAt, title, extractors, tags }]

// Paginated search: { items, total, page, limit }
const page = await client.searchSnapshotsPage("climate change policy", { page: 2, limit: 20 });
```

## Get and delete snapshots

```typescript
const snapshot = await client.getSnapshot(1); // null if it does not exist
await client.deleteSnapshot(1); // resolves to false if it did not exist
```

## Tags

```typescript
// Create a tag
const tag = await client.createTag("research", "#4f46e5");

// Add to a snapshot
await client.addTagToSnapshot(1, tag.id);

// List tags on a snapshot
const tags = await client.listSnapshotTags(1);

// Remove a tag from a snapshot
await client.removeTagFromSnapshot(1, tag.id);
```

## Bulk import

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss",
});
// { queued: 12, skipped: 3, total: 15, format: "rss" }
```

Supported `format` values: `rss`, `opml`, `netscape`, `text`.

## Full API reference

See [SDK API reference](/reference/sdk-api) for all types and method signatures.
