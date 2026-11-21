---
"@webfrost/sdk": minor
---

The SDK is ready to publish to npm as `@webfrost/sdk`.

- Type declarations are generated and shipped (`dist/index.d.ts`); the package is ESM with a proper `exports` map, and the tarball holds only `dist`, the README and the LICENSE. Verified with publint and Are the Types Wrong.
- New client options: `timeoutMs` (default 30s, `0` disables), `fetch`, `credentials` (default `"same-origin"`) and `retries` / `retryDelayMs` / `maxRetryDelayMs` (GET and HEAD only, exponential backoff with jitter, honours `Retry-After`).
- Every method takes a trailing `{ signal }` to abort the request.
- `WebFrostError` gains `code` (the server's machine-readable code, or `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, `INVALID_RESPONSE`); network failures and timeouts are now `WebFrostError` instead of a raw `TypeError`. The server's `{ error, code }` body is surfaced by every method, GETs included.
- New methods: `iterateSnapshots`, `importFile`, `archiveUrl`, `downloadArchive`.
- All public types are exported (`SetupResult`, `SetupStatusResult`, `ExtractorMeta`, `RequestOptions`, ...). Snapshot status is `"pending" | "done" | "failed"` and a schedule's `lastStatus` is `"success" | "failed" | null`.
- Breaking: `SearchResult.status` is `null` instead of `""` when the server reports none; `ListSnapshotsOptions.status` only accepts the status union.
