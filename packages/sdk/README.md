# @webfrost/sdk

TypeScript client for the [WebFrost](https://github.com/webfrost/webfrost) server REST API.

## Quick start

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({ baseUrl: "http://localhost:3000" });

// Kick off a new archive
const { id } = await client.createSnapshot("https://example.com");

// List all snapshots
const snapshots = await client.listSnapshots();

// Fetch a single snapshot with extractor results
const detail = await client.getSnapshot(id);
if (detail) {
  console.log(detail.archiveResults);
}
```

## API

### `new WebFrostClient(options)`

| Option    | Type     | Description                                     |
| --------- | -------- | ----------------------------------------------- |
| `baseUrl` | `string` | Base URL of the WebFrost server (no trailing /) |

### `client.createSnapshot(url)`

Queues a new snapshot for the given URL. Returns a `SnapshotCreated` object (`{ id, url, status }`). Throws `WebFrostError` on invalid input or server error.

### `client.listSnapshots()`

Returns `Snapshot[]` — all snapshots ordered by id.

### `client.getSnapshot(id)`

Returns `SnapshotDetail | null`. Returns `null` for a 404. Throws `WebFrostError` for other HTTP errors.

## Error handling

```ts
import { WebFrostError } from "@webfrost/sdk";

try {
  await client.createSnapshot("not-a-url");
} catch (err) {
  if (err instanceof WebFrostError) {
    console.error(err.status, err.message); // e.g. 400, "invalid url"
  }
}
```
