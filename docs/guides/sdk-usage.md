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
  baseUrl: "http://localhost:3000",
  apiKey: "wf_your_api_key_here",
});
```

## Archive a URL

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending" }
```

The server processes the archive asynchronously. Poll `getSnapshot` or list snapshots to check completion.

## List and search snapshots

```typescript
// List with pagination
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });

// Full-text search
const results = await client.searchSnapshots("climate change policy");
// [{ id, url, snippet: "...climate <mark>change</mark>...", rank }]
```

## Get and delete snapshots

```typescript
const snapshot = await client.getSnapshot(1);
await client.deleteSnapshot(1);
```

## Tags

```typescript
// Create a tag
const tag = await client.createTag("research", "#4f46e5");

// Add to a snapshot
await client.addTagToSnapshot(snapshot.id, tag.id);

// List tags on a snapshot
const tags = await client.listSnapshotTags(snapshot.id);

// Remove a tag from a snapshot
await client.removeTagFromSnapshot(snapshot.id, tag.id);
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
