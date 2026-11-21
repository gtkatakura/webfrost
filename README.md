<p align="center">
  <a href="https://webfrost.dev"><img src=".github/assets/banner.webp" width="720" alt="WebFrost: an arctic fox asleep on a frozen archive box, with the formats it keeps around it"></a>
</p>

# WebFrost

[![CI](https://github.com/gtkatakura/webfrost/actions/workflows/ci.yml/badge.svg)](https://github.com/gtkatakura/webfrost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1d64d8)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-webfrost.dev-7cc4ff)](https://webfrost.dev)

**Keep the web pages you care about, on your own machine.** WebFrost archives a URL to every format worth
keeping and lets you search what you saved. Run it from a terminal, a script or a browser.

- **Every format from one visit.** WARC, raw HTML, readable text, PDF, a full-page screenshot, the rendered
  DOM, a self-contained HTML file and, for media pages, the video, all from one fetch and one browser
  navigation.
- **Keeps running on its own.** Cron schedules and RSS feeds run inside the server; jobs survive crashes
  and are spaced out per site.
- **Safe to put on a network.** API keys, revocable sessions, rate limits, a read-only public mode, and a
  guard that stops archived pages from reaching your internal network.
- **Plain files, no lock-in.** An archive is a folder with one SQLite database and the files next to it,
  or an S3-compatible bucket.

📖 **Documentation: [webfrost.dev](https://webfrost.dev)**

> WebFrost is young (`0.x`). It works, and it is tested, but the HTTP API and the SDK can still change
> before 1.0. See the [roadmap](ROADMAP.md).

## Install

**Docker**, for the server, the web UI and the scheduler. The image bundles Chromium, yt-dlp and ffmpeg,
so every format works out of the box, on amd64 and arm64:

```bash
curl -fsSLO \
  https://raw.githubusercontent.com/gtkatakura/webfrost/main/docker-compose.prod.yml
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.prod.yml up -d
```

Open http://localhost:3000 and create the admin user. For a real deployment (reverse proxy, TLS,
backups) see [Deploy](https://webfrost.dev/docs/guides/deploy).

**The `webfrost` binary**, for macOS, Linux and Windows. One file with the CLI and the server:

```bash
# or: brew install gtkatakura/tap/webfrost
curl -fsSL https://webfrost.dev/install.sh | sh

# a headless Chromium, if you have none
webfrost setup

# server, web UI and scheduler on :3000
webfrost serve
```

**The SDK**, to talk to a server from your own code: `npm install @webfrost/sdk`.

## Four ways in

| | |
|---|---|
| **Web UI** | Dashboard, search with highlights, previews of every format, tags, schedules, imports. [Guide](https://webfrost.dev/docs/guides/web-ui) |
| **CLI** | Archive, import, search and schedule from a terminal, straight against an archive folder. [Reference](https://webfrost.dev/docs/reference/cli) |
| **HTTP API** | Everything the UI does, over REST, with API keys. [Reference](https://webfrost.dev/docs/reference/rest-api) |
| **TypeScript SDK** | A typed client with no dependencies, for Bun, Node and the browser. [Reference](https://webfrost.dev/docs/reference/sdk) |

```bash
webfrost add https://example.com
webfrost search "example domain"

# Netscape bookmarks, OPML, RSS/Atom or a list of URLs
webfrost import bookmarks.html

# re-archive every hour
webfrost schedule add https://example.com --cron "0 * * * *"
```

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000/api",
  apiKey: process.env.WEBFROST_API_KEY,
});
const { id } = await client.createSnapshot("https://example.com");
```

## How it compares

[ArchiveBox](https://archivebox.io) is the most mature self-hosted web archiver, and if it already works for
you there is no reason to switch. WebFrost is a different take on the same idea:

- **One visit per page.** WebFrost fetches a page once and opens it in the browser once; every format is
  produced from those two visits. ArchiveBox runs each extractor on its own.
- **Built to be embedded.** The CLI, the HTTP API and the SDK are first-class, with a typed client and
  the same archive folder usable from all of them.
- **TypeScript on Bun**, one process, SQLite. Easy to read, easy to run.

ArchiveBox supports more inputs today (a browser extension, browser history, Pocket and Pinboard exports)
and has years of real-world use behind it. A [benchmark harness](BENCHMARKS.md) comparing the two is in
the repository; numbers will be published once it has run.

## FAQ

**Where is my data?** In `WEBFROST_DIR` (`/data` in Docker): `archive.db` plus one folder per snapshot. Back
it up like any folder. See [Disk layout](https://webfrost.dev/docs/reference/disk-layout).

**Can I archive pages behind a login?** Not yet: every page is fetched as an anonymous visitor. It is on the
[roadmap](ROADMAP.md).

**Can I share my archive?** Yes. With `WEBFROST_PUBLIC_READ=true` anyone can browse and search; only you can
archive, delete or change settings. See [Public read](https://webfrost.dev/docs/guides/public-read).

**How much does it need?** One process, plus a headless Chromium while a page is being archived. A small
VPS or a home server is enough for personal use; `WEBFROST_CONCURRENCY` limits parallel archives.

**Is it safe to archive any URL?** Archived pages cannot reach private addresses through the server or
the browser, and previews run sandboxed. Read [Security](https://webfrost.dev/docs/architecture/security)
before exposing it to other people.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) shows how to run
WebFrost from source and what a good pull request looks like; questions
go to [Discussions](https://github.com/gtkatakura/webfrost/discussions), and security issues to
[SECURITY.md](SECURITY.md), never to a public issue.

## License

[MIT](LICENSE)
