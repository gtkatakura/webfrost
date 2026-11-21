---
"@webfrost/server": patch
"@webfrost/sdk": patch
"@webfrost/core": patch
---

Server security fixes from the pre-release review:

- **CSRF:** state-changing `/api` requests without a bearer token must come from the app's own origin (`Sec-Fetch-Site: same-origin`/`none`, or an `Origin` matching `Host`), otherwise `403 CROSS_ORIGIN_REQUEST`. Request bodies must be `application/json` (multipart only for `POST /api/import/file`), otherwise `415`.
- **Rate limits behind a proxy:** with `WEBFROST_TRUST_PROXY=true` the client address is the right-most `X-Forwarded-For` entry (new `WEBFROST_TRUSTED_PROXY_HOPS`, default `1`), not the client-controlled left-most one. IPv6 clients are limited per `/64`.
- **S3 downloads:** presigned URLs now sign `response-content-type` and `response-content-disposition: attachment`, so archived HTML never renders on the bucket's origin. `StorageBackend.presignedDownloadUrl` takes an optional third `response` argument.
- **First-run setup:** new `WEBFROST_SETUP_TOKEN`; when set, `POST /api/setup` requires it (`setupToken` field or `X-Setup-Token` header, `403 SETUP_TOKEN_INVALID` otherwise), and the setup page asks for it. `GET /api/setup/status` reports `setupTokenRequired`. Without a token the server warns at startup while no admin exists. SDK: `completeSetup(username, password, setupToken?)` and `SetupStatusResult.setupTokenRequired`.
- **Bind address:** new `HOST`. With `AUTH_DISABLED=true` the server binds to `127.0.0.1` unless `HOST` is set (default otherwise `0.0.0.0`). Containers that run with `AUTH_DISABLED=true` need `HOST=0.0.0.0`.
- **Limits:** passwords up to 1024 characters, usernames 128, API key and tag names 100, URLs 8192 (`400 VALIDATION` beyond). Imports are capped by `WEBFROST_IMPORT_MAX_BYTES` (default 10 MiB) and `WEBFROST_IMPORT_MAX_URLS` (default 10000) with `413 PAYLOAD_TOO_LARGE`. `GET /api/snapshots` caps `limit` at 200.
- **Errors:** every JSON error is `{ error, code }` with a machine-readable `code`. Unknown `/api/*` routes answer a JSON `404` instead of the SPA's HTML; malformed JSON is `400 INVALID_JSON`; validation failures are `400 VALIDATION` (login used to answer Elysia's `422`). Security headers are set on every response, errors included.
- **Guests:** anonymous visitors (`WEBFROST_PUBLIC_READ`) see `extraction failed` instead of raw extractor errors.
- **Sessions:** `POST /api/auth/logout` answers `204` and clears the cookie even when the session is expired or invalid. Logging in revokes the session in the cookie it replaces.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops accepting requests and the scheduler, then waits up to `WEBFROST_SHUTDOWN_TIMEOUT_MS` (default 20 s) for running archive jobs before exiting; unfinished jobs resume on the next start.
