# @webfrost/sdk

TypeScript client for the [WebFrost](https://github.com/gtkatakura/webfrost) server REST API.
Runs anywhere `fetch` does (Bun, Node 18+, browsers) and has no dependencies.

## Quick start

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  // The API lives under /api — include it in the base URL.
  baseUrl: "http://localhost:3000/api",
  // Create a key in Settings → API Keys, or with `webfrost admin key create`.
  apiKey: process.env.WEBFROST_API_KEY,
});

// Queue a new archive (returns immediately; the pipeline runs in the background)
const { id } = await client.createSnapshot("https://example.com");

// Poll until it settles
let detail = await client.getSnapshot(id);
while (detail?.status === "pending") {
  await new Promise((r) => setTimeout(r, 1000));
  detail = await client.getSnapshot(id);
}
console.log(detail?.status, detail?.extractors);

// List snapshots, one page at a time
const { items, total } = await client.listSnapshots({ page: 1, limit: 20 });

// Full-text search
const hits = await client.searchSnapshotsPage("web archiving", { page: 1, limit: 20 });
```

## API

### `new WebFrostClient(options)`

| Option    | Type     | Description                                                              |
| --------- | -------- | ------------------------------------------------------------------------ |
| `baseUrl` | `string` | API base URL including the `/api` prefix, e.g. `http://localhost:3000/api` |
| `apiKey`  | `string` | Optional. Sent as `Authorization: Bearer <key>`. Omit in the browser to use the session cookie. |

### `client.createSnapshot(url)`

Queues a new snapshot for the given URL. Returns `{ id, url, status }` with `status: "pending"`.
Throws `WebFrostError` on invalid input or server error.

### `client.listSnapshots({ page?, limit?, status? })`

Returns `{ items, total, page, limit }`. `status` filters by `pending`, `done` or `failed`.

### `client.getSnapshot(id)`

Returns `SnapshotDetail | null` (`null` for a 404). The detail includes the stored
`archiveResults`, per-extractor `extractorMeta` (status, duration, size, error) and the same
summary fields as the list (`title`, `extractors`, `tags`, `screenshotUrl`).

### `client.searchSnapshots(query)`

Returns `SearchResult[]` (first page): `{ id, url, snippet, rank, status, createdAt, title, extractors, tags }`. Snippets are HTML-escaped by the server and contain only literal `<mark>`/`</mark>` markup.

### `client.searchSnapshotsPage(query, { page?, limit? })`

Returns `{ items, total, page, limit }` for paginated search.

The client also covers tags, schedules, imports, stats, API keys and auth — see the
[SDK reference](../../apps/docs/content/docs/reference/sdk.mdx) for every method.

## Error handling

```ts
import { WebFrostError } from "@webfrost/sdk";

try {
  await client.createSnapshot("not-a-url");
} catch (err) {
  if (err instanceof WebFrostError) {
    console.error(err.status, err.message); // e.g. 400, "invalid url"
    // On 429, err.retryAfter is the Retry-After header in seconds (if sent)
  }
}
```

| Status | Meaning |
| ------ | ------- |
| 401 | Missing, expired or revoked credentials |
| 403 | Authenticated, but the request was refused (e.g. wrong current password) |
| 429 | Rate limited — wait `err.retryAfter` seconds |

## License

MIT
