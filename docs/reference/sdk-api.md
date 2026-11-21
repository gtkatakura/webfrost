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
| `baseUrl` | `string` | Yes | API base URL **including the `/api` prefix**, e.g. `http://localhost:3000/api`. The client appends paths such as `/snapshots` to it. |
| `apiKey` | `string` | No | API key (create via the setup wizard, **Settings → API Keys**, or `webfrost admin key create`). Sent as `Authorization: Bearer <key>` on every request. |

Failed requests throw `WebFrostError` with the HTTP `status` and, on `429`, `retryAfter` (seconds, from the `Retry-After` header).

---

## Snapshots

### `createSnapshot(url: string): Promise<SnapshotCreated>`

Submit a URL for archiving. Returns immediately with `status: "pending"`.

```typescript
const snapshot = await client.createSnapshot("https://example.com");
// { id: 1, url: "https://example.com", status: "pending" }
```

### `listSnapshots(options?: { page?, limit?, status? }): Promise<SnapshotPage>`

Returns `{ items, total, page, limit }`.

```typescript
const { items, total, page, limit } = await client.listSnapshots({ page: 1, limit: 20 });

// Filter by status
const pending = await client.listSnapshots({ status: "pending" });
```

### `searchSnapshots(query: string): Promise<SearchResult[]>`

Full-text search across archived content.

```typescript
const results = await client.searchSnapshots("climate change");
// [{ id, url, snippet: "...<mark>climate change</mark>...", rank,
//    status, createdAt, title, extractors, tags }]
```

Snippets are HTML-escaped by the server; the only markup is literal `<mark>`/`</mark>`. Render them as text, never as raw HTML.

### `searchSnapshotsPage(query: string, options?: { page?: number; limit?: number }): Promise<SearchPage>`

Paginated full-text search. `searchSnapshots` returns only the first page's items.

```typescript
const { items, total, page, limit } = await client.searchSnapshotsPage("climate change", {
  page: 2,
  limit: 20,
});
```

### `getSnapshot(id: number): Promise<SnapshotDetail | null>`

Resolves to `null` when the snapshot does not exist.

```typescript
const snapshot = await client.getSnapshot(1);
```

### `deleteSnapshot(id: number): Promise<boolean>`

Resolves to `true` when deleted, `false` when the snapshot did not exist.

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

### `deleteTag(id: number): Promise<boolean>`

`false` when the tag did not exist.

### `listSnapshotTags(snapshotId: number): Promise<Tag[]>`

### `addTagToSnapshot(snapshotId: number, tagId: number): Promise<Tag>`

### `removeTagFromSnapshot(snapshotId: number, tagId: number): Promise<boolean>`

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

## Import history

### `listImports(): Promise<ImportRecord[]>`

## Auth, setup and administration

| Method | Returns |
|---|---|
| `getSetupStatus()` | `{ needsSetup }` |
| `completeSetup(username, password)` | `{ apiKey }` — password must be at least 8 characters |
| `login(username, password)` | `{ ok }` |
| `logout()` | `void` |
| `getMe()` | `{ username }` (`null` for API-key auth) |
| `changePassword(currentPassword, newPassword)` | `void` — throws `WebFrostError` with status `403` when the current password is wrong |
| `getStats()` | `DashboardStats` |
| `getServerInfo()` | `{ version, storagePath, snapshotCount }` |
| `listApiKeys()` | `ApiKey[]` |
| `createApiKey(name)` | `ApiKeyCreated` (includes `rawKey`, shown once) |
| `revokeApiKey(id)` | `boolean` |

---

## Types

```typescript
interface SnapshotCreated {
  id: number;
  url: string;
  status: string; // "pending"
}

interface Snapshot {
  id: number;
  url: string;
  status: string; // "pending" | "done" | "failed"
  createdAt: string;
  extractors: string[]; // extractors that succeeded
  tags: Tag[];
  title: string | null;
  excerpt: string | null;
  screenshotUrl: string | null;
}

interface SnapshotDetail extends Snapshot {
  archiveResults: { id: number; extractor: string; content: string | null; createdAt: string }[];
  extractorMeta: Record<
    string,
    { status: "success" | "failed"; durationMs: number | null; fileSizeBytes: number | null; error?: string }
  >;
}

interface SnapshotPage {
  items: Snapshot[];
  total: number;
  page: number;
  limit: number;
}

interface Tag {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  createdAt: string;
}

interface SearchResult {
  id: number;
  url: string;
  snippet: string;
  rank: number;
  status: string;
  createdAt: string;
  title: string | null;
  extractors: string[];
  tags: Tag[];
}

interface SearchPage {
  items: SearchResult[];
  total: number;
  page: number;
  limit: number;
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
  format: "rss" | "opml" | "netscape" | "text";
}
```
