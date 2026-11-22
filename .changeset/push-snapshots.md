---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/cli": minor
"@webfrost/sdk": minor
---

Archive on your machine, keep it on the server. `webfrost push <id...> --to <url>` sends finished snapshots to a WebFrost server, which stores each one as a new snapshot with the same files, results, status, capture time and tags, without fetching anything again: useful when the server cannot archive a page itself (video sites often refuse server addresses) or to archive on a laptop and keep everything in one place. The API key comes from `WEBFROST_API_KEY`, never from a flag.

Snapshots travel as snapshot bundles, one ZIP file with a `manifest.json` and the snapshot's files: `webfrost export <id> -o file.zip` writes one, `webfrost import file.zip` stores one in a local archive, the new `POST /api/v1/snapshots/import` route (`application/zip` body, `201 { id, url, status }`) and the SDK's `importSnapshot()` upload one. The server checks bundles strictly (manifest schema, known extractors, fixed file names, no unreferenced entries, size limits before and while decompressing) and accepts up to `WEBFROST_IMPORT_BUNDLE_MAX_BYTES` (default 2 GiB). Other routes now refuse a chunked request body without `Content-Length` (`411`).
