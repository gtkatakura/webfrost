# Reference: SDK

`@webfrost/sdk` is a TypeScript client for the WebFrost server API.

---

## Install

```bash
bun add @webfrost/sdk
# or
npm install @webfrost/sdk
```

---

## Create a client

```typescript
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000",
  apiKey: "wf_your_api_key_here",
});
```

---

## Snapshots

### Create a snapshot

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending" }
```

### List snapshots

```typescript
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });
// items: [{ id, url, createdAt, extractors: [...], tags: [...] }]
```

### Search snapshots

```typescript
const results = await client.searchSnapshots("climate change policy");
// [{ id, url, snippet: "...climate <mark>change</mark>...", rank }]
```

### Get a snapshot

```typescript
const snapshot = await client.getSnapshot(1);
```

### Delete a snapshot

```typescript
await client.deleteSnapshot(1);
```

---

## Tags

### Create a tag

```typescript
const tag = await client.createTag("research", "#4f46e5");
```

### Add tag to snapshot

```typescript
await client.addTagToSnapshot(1, tag.id);
```

### List tags on a snapshot

```typescript
const tags = await client.listSnapshotTags(1);
```

### Remove a tag from a snapshot

```typescript
await client.removeTagFromSnapshot(1, tag.id);
```

---

## Import

### Import URLs from a feed or file

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss",
});
// { queued: 12, skipped: 3, total: 15, format: "rss" }
```

Supported `format` values: `rss`, `opml`, `netscape`, `text`.

---

## REST API

The full REST API is documented in [Reference: REST API](./rest-api.md). The SDK is a typed wrapper around those endpoints.
