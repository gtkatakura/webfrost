# @webfrost/sdk

TypeScript client for the [WebFrost](https://github.com/gtkatakura/webfrost) REST API.
It wraps `fetch`, has no dependencies, and runs on Node 18+, Bun and in browsers.
ESM only, with bundled type declarations.

Full reference: [webfrost.dev/docs/reference/sdk](https://webfrost.dev/docs/reference/sdk).

## Install

```sh
npm install @webfrost/sdk
```

Available from `0.1.0`.

## Quick start

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  // The API lives under /api: include it in the base URL.
  baseUrl: "http://localhost:3000/api",
  apiKey: process.env.WEBFROST_API_KEY,
});

// Queue a new archive (returns at once; the pipeline runs in the background)
const { id } = await client.createSnapshot("https://example.com");

// Poll until it settles
let detail = await client.getSnapshot(id);
while (detail?.status === "pending") {
  await new Promise((r) => setTimeout(r, 1000));
  detail = await client.getSnapshot(id);
}
console.log(detail?.status, detail?.extractors);

// Full-text search
const { items } = await client.searchSnapshotsPage("web archiving", { limit: 20 });
```

## Authentication

| Where | Use | Why |
| --- | --- | --- |
| Node, Bun, scripts, servers | `apiKey` | Sent as `Authorization: Bearer <key>` on every request. Create one in the web UI (Settings), with `webfrost admin key create`, or from `completeSetup()`. |
| A browser page served by WebFrost | the session cookie | `login()` sets it; the browser sends it. Leave `apiKey` out. |
| A browser page on another origin | `credentials: "include"` | Needed for the cookie to be stored and sent cross-origin. |

Outside a browser nothing keeps a session cookie, so `login()` is not useful there: use an API key.

## Options

```ts
const client = new WebFrostClient({
  baseUrl: "http://localhost:3000/api",
  apiKey: "...",
  timeoutMs: 30_000, // per attempt; 0 disables. Default 30000.
  retries: 2, // GET/HEAD only. Default 0.
  retryDelayMs: 250, // backoff base. Default 250.
  maxRetryDelayMs: 30_000, // longest wait between attempts. Default 30000.
  credentials: "same-origin", // fetch credentials mode. Default "same-origin".
  fetch: myFetch, // custom fetch (SSR, tests, proxies). Default: the global fetch.
});
```

## Errors

Every failure is a `WebFrostError`, never a bare `TypeError` or `AbortError`:

```ts
import { WebFrostError } from "@webfrost/sdk";

try {
  await client.createSnapshot("not-a-url");
} catch (err) {
  if (err instanceof WebFrostError) {
    console.error(err.status, err.code, err.message); // 400 "BAD_REQUEST" "invalid url"
    // err.retryAfter: seconds from the Retry-After header, when sent (typically on 429)
  }
}
```

| Field | Meaning |
| --- | --- |
| `status` | HTTP status, or `0` when there was no response |
| `code` | Machine-readable: the server's `code` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `RATE_LIMITED`, ...), or from the client `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, `INVALID_RESPONSE`. Branch on this, not on `message`. |
| `message` | The server's `error` text, or the status text |
| `retryAfter` | Seconds to wait, from `Retry-After` |
| `cause` | The underlying error for network failures and timeouts |

**Not found.** A single lookup that finds nothing resolves `null` (`getSnapshot`); a delete of something
missing resolves `false` (`deleteSnapshot`, `deleteTag`, `deleteSchedule`, `revokeApiKey`,
`removeTagFromSnapshot`); listing the tags of a missing snapshot resolves `[]`. Every other 404 throws
with code `NOT_FOUND`.

## Timeouts, retries and abort

Every method takes a final `{ signal }` argument. It is combined with the client's timeout, and either
one ends the request: `ABORTED` for the signal, `TIMEOUT` for the timeout.

```ts
const controller = new AbortController();
const page = client.listSnapshots({ status: "done" }, { signal: controller.signal });
controller.abort(); // rejects with WebFrostError, code "ABORTED"
```

With `retries` set, **GET and HEAD** requests are retried on network errors, timeouts, `429` and
`502`/`503`/`504`, with exponential backoff and jitter. A `Retry-After` header is honoured; if it is
longer than `maxRetryDelayMs` the error is thrown instead of waiting. Writes are never retried: a
POST or PATCH that reached the server could run twice, and a retried DELETE would report "not found"
for something it had just deleted.

## Pagination

```ts
// One page
const { items, total, page, limit } = await client.listSnapshots({ page: 1, limit: 20 });

// Everything, a page at a time (100 per request unless you pass `limit`)
for await (const snapshot of client.iterateSnapshots({ status: "done" })) {
  console.log(snapshot.id, snapshot.url);
}
```

`iterateSnapshots` is lazy: breaking out of the loop stops fetching.

## Archives and imports

```ts
// A URL for <a href>, <img src> or <iframe src> (the browser sends the session cookie)
client.archiveUrl(id, "screenshot"); // .../snapshots/1/archives/screenshot/download
client.archiveUrl(id, "singlefile", "preview"); // sandboxed HTML preview

// Fetch with the client's auth (works with an API key)
const res = await client.downloadArchive(id, "warc");
const blob = await res.blob();

// Import bookmarks, OPML, RSS or a plain list of URLs from a file
await client.importFile(new Blob([text]), "text", { filename: "urls.txt" });
await client.importUrls({ url: "https://example.com/feed.xml", format: "rss" });
```

## License

MIT
