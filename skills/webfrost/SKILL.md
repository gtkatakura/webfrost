---
name: webfrost
description: Archive web pages and search the archive with WebFrost, a self-hosted web archiver, from its CLI, HTTP API or TypeScript SDK. Use when the user wants to save a web page or a list of URLs (WARC, PDF, screenshot, readable text, self-contained HTML, video), find something they archived, download an archived format, import bookmarks or feeds, or schedule pages to be archived again.
license: MIT
metadata:
  homepage: https://webfrost.dev
  source: https://github.com/gtkatakura/webfrost
---

# Using WebFrost

WebFrost archives a URL in every format worth keeping and makes the text searchable. One visit to a
page produces: `warc`, `html`, `readability` (title, byline, plain text), `pdf`, `screenshot`
(full-page PNG), `dom-snapshot` (the rendered DOM), `singlefile` (one self-contained HTML file) and,
for media pages, `media` plus `media-metadata` (via yt-dlp).

Full documentation: https://webfrost.dev/docs. Fetch the relevant reference page when you need a
detail this skill does not cover.

## Pick the surface

1. **A WebFrost server is running** (the user gives a URL like `http://localhost:3000` or a host name):
   use the HTTP API or the SDK with an API key. Ask for the base URL and an API key if you don't have
   them; never invent one. Keys are created in the web UI (Settings → API keys) or with
   `webfrost admin key create`.
2. **No server, just this machine:** use the `webfrost` CLI against an archive folder
   (`WEBFROST_DIR`, default `~/.webfrost`).
3. **Writing code:** call the HTTP API, or use `@webfrost/sdk` (TypeScript, ESM, Node 18+, Bun, browsers) once it is on npm.

Check what is available first: `webfrost --version` and `webfrost doctor` for the CLI, or
`GET <base>/health` (returns `{"status":"ok"}`) for a server.

## CLI

```bash
webfrost add https://example.com          # archive one URL; exits non-zero unless it finished
webfrost list --limit 20 --json           # newest first
webfrost search "climate change" --json   # full-text search over URL, title, text and tags
webfrost import bookmarks.html            # Netscape bookmarks, OPML, RSS/Atom, or one URL per line
webfrost schedule add https://example.com --cron "0 6 * * *"
webfrost tag add <snapshot-id> <tag>
webfrost delete <snapshot-id>
webfrost push <snapshot-id> --to https://archive.example.com     # send a snapshot archived here to a server
webfrost rescue blocked --from https://archive.example.com --dry-run
                                          # archive here what the server could not, replacing its failures
webfrost help <command>                   # every command has --help
```

Prefer `--json` when you need to read the result. The archive folder holds `archive.db` plus one
folder per snapshot with the files (see https://webfrost.dev/docs/reference/disk-layout).

## HTTP API

Base path `/api/v1` (the unversioned `/api` is a deprecated alias), JSON in and out, `Authorization: Bearer <api-key>`. Errors are
`{ "error": "...", "code": "..." }`.

```bash
API=http://localhost:3000/api/v1
# Archive: returns 202 with { id, url, status: "pending" }. The work happens in the background.
curl -X POST "$API/snapshots" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"url":"https://example.com"}'

# Poll until status is "done" or "failed" (every 2–5 s; most pages take seconds, video longer).
curl "$API/snapshots/1" -H "Authorization: Bearer $KEY"

# Search, list, download one format.
curl "$API/snapshots?q=climate%20change&limit=20" -H "Authorization: Bearer $KEY"
curl "$API/snapshots?status=done&page=1&limit=20" -H "Authorization: Bearer $KEY"
curl -OJ "$API/snapshots/1/archives/pdf/download" -H "Authorization: Bearer $KEY"
```

- A snapshot is `done` even when some formats failed: check `extractorMeta[<format>].status` in the
  detail response before telling the user a format exists.
- Search results carry a `snippet` whose only markup is `<mark>`; show it as text with highlights.
- `GET` requests allow 300 per minute; creating snapshots and imports 60 per minute. On `429`, wait
  for `Retry-After` seconds.
- Bulk work: `POST /api/v1/import` with `{ "content": "...", "format": "text" | "netscape" | "opml" |
  "rss" }` or `{ "url": "<feed or list URL>" }` queues many URLs at once; don't loop over
  `POST /api/v1/snapshots` for hundreds of URLs.
- Reference: https://webfrost.dev/docs/reference/rest-api

## SDK

`@webfrost/sdk` is not on npm yet: it will be published after the first release. Until then,
use the HTTP API. Once it is installable:

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.WEBFROST_API_KEY,
  retries: 2, // GET/HEAD only, with backoff; honours Retry-After
});

const { id } = await client.createSnapshot("https://example.com");
const snapshot = await client.getSnapshot(id); // null when it does not exist
const page = await client.searchSnapshotsPage("climate change", { page: 1 });
for await (const s of client.iterateSnapshots({ status: "done" })) console.log(s.url);
```

Errors are `WebFrostError` with `status` and `code` (`NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`, ...).
Every method takes an optional `{ signal }`. Reference (once published): https://webfrost.dev/docs/reference/sdk

## Things to tell the user

- Pages behind a login are archived as an anonymous visitor sees them.
- A `failed` snapshot says why in `failure` (`{ category, class, label, detail }`): `permanent` (page or
  domain gone) will not get better with a retry, `transient` may, `blocked` means the site refuses the
  server; those can often be archived from the user's own machine with `webfrost rescue`.
- Private and internal addresses (localhost, 10.x, 192.168.x, cloud metadata) are refused unless the
  server sets `WEBFROST_ALLOW_PRIVATE_URLS=true`. Don't ask them to enable it just to get past an error;
  explain the risk.
- Sites are archived politely: archives of the same host are spaced out (`WEBFROST_DOMAIN_DELAY_MS`),
  so a large import of one site takes a while by design.
