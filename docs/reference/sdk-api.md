---
title: SDK API reference
description: TypeScript API reference for @webfrost/sdk.
---

# SDK API reference

`@webfrost/sdk` — TypeScript client for the WebFrost server REST API.

## Install

```bash
bun add @webfrost/sdk
# or
npm install @webfrost/sdk
```

## WebFrostClient

### Constructor

```typescript
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient(options: WebFrostClientOptions);
```

**`WebFrostClientOptions`**

| Field | Type | Required | Description |
|---|---|---|---|
| `baseUrl` | `string` | Yes | Server URL, e.g. `http://localhost:3000` |
| `apiKey` | `string` | Yes | API key created via `webfrost admin key create` |

---

## Snapshots

### `createSnapshot(url: string): Promise<Snapshot>`

Submit a URL for archiving. Returns immediately with `status: "pending"`.

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending", createdAt: "..." }
```

### `listSnapshots(options?): Promise<{ items: Snapshot[], total: number }>`

```typescript
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });

// Filter by status
const pending = await client.listSnapshots({ status: "pending" });
```

### `searchSnapshots(query: string): Promise<SearchResult[]>`

Full-text search across archived content.

```typescript
const results = await client.searchSnapshots("climate change");
// [{ id, url, snippet: "...<mark>climate change</mark>...", rank }]
```

### `getSnapshot(id: number): Promise<Snapshot>`

```typescript
const snapshot = await client.getSnapshot(1);
```

### `deleteSnapshot(id: number): Promise<void>`

```typescript
await client.deleteSnapshot(1);
```

---

## Tags

### `createTag(name: string, color?: string): Promise<Tag>`

```typescript
const tag = await client.createTag("research", "#4f46e5");
```

### `listTags(): Promise<Tag[]>`

```typescript
const tags = await client.listTags();
```

### `deleteTag(id: number): Promise<void>`

### `listSnapshotTags(snapshotId: number): Promise<Tag[]>`

### `addTagToSnapshot(snapshotId: number, tagId: number): Promise<void>`

### `removeTagFromSnapshot(snapshotId: number, tagId: number): Promise<void>`

---

## Schedules

### `listSchedules(): Promise<Schedule[]>`

```typescript
const schedules = await client.listSchedules();
```

### `createSchedule(url: string, cron: string): Promise<Schedule>`

```typescript
const schedule = await client.createSchedule("https://example.com", "0 9 * * *");
```

### `updateSchedule(id: number, update: { paused: boolean }): Promise<Schedule>`

Pause or resume a schedule.

```typescript
await client.updateSchedule(1, { paused: true });  // pause
await client.updateSchedule(1, { paused: false }); // resume
```

### `deleteSchedule(id: number): Promise<boolean>`

```typescript
await client.deleteSchedule(1);
```

---

## Import

### `importUrls(options): Promise<ImportResult>`

```typescript
const result = await client.importUrls({
  url: "https://example.com/feed.xml",
  format: "rss", // "rss" | "opml" | "netscape" | "text"
});
// { queued: 12, skipped: 3, total: 15, format: "rss" }
```

---

## Types

```typescript
interface Snapshot {
  id: number;
  url: string;
  status: "pending" | "complete" | "failed";
  createdAt: string;
  extractors?: ExtractorResult[];
  tags?: Tag[];
}

interface ExtractorResult {
  extractor: string;
  filePath: string;
  mimeType: string;
  createdAt: string;
}

interface Tag {
  id: number;
  name: string;
  color: string | null;
}

interface SearchResult {
  id: number;
  url: string;
  snippet: string;
  rank: number;
}

interface Schedule {
  id: number;
  url: string;
  cron: string;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  paused: boolean;
  lastStatus: string | null;
  consecutiveFailures: number;
}

interface ImportResult {
  queued: number;
  skipped: number;
  total: number;
  format: string;
}
```
