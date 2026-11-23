---
"@webfrost/core": patch
"@webfrost/server": patch
"@webfrost/cli": patch
---

URL imports, feed imports and RSS schedules stop downloading at `WEBFROST_IMPORT_MAX_BYTES` (a larger `Content-Length` is refused before the body is read) instead of buffering up to 50 MB first. Fetch errors name the host you asked for, not the address the request was pinned to. The size backfill no longer records 0 bytes when storage fails for a reason other than a missing file; it retries later. `GET /imports` rejects malformed `page` and `limit` with `400`, as `GET /snapshots` does. Interrupted bundle imports are swept every five minutes, not only at startup, and an upload or import in progress is never swept.
