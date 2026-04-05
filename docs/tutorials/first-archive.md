# Tutorial: Archive Your First Page

This tutorial walks you through installing WebFrost and capturing your first web snapshot from scratch. By the end you will have a working local archive and understand the basic workflow.

**Time:** ~10 minutes
**Prerequisites:** [Bun](https://bun.sh) v1.x, Chromium (for PDF and screenshot extractors)

---

## 1. Clone and install

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
bun install
```

`bun install` fetches all workspace dependencies across `@webfrost/core`, `@webfrost/cli`, and `@webfrost/server`.

---

## 2. Create your data directory

WebFrost stores everything — the SQLite database and all archive files — in a single directory you control.

```bash
mkdir -p ./data
```

---

## 3. Initialize the archive

```bash
WEBFROST_DIR=./data bun run webfrost init
# Initialized archive at ./data
```

This creates the SQLite database (`archive.db`) inside `./data`. Nothing is downloaded yet.

---

## 4. Archive a URL

```bash
WEBFROST_DIR=./data bun run webfrost add https://example.com
# Archiving https://example.com...
# ✓ snapshot abc123 — warc, pdf, screenshot, readability, dom-snapshot, singlefile
```

What just happened:

- WebFrost launched a headless Chromium browser and navigated to the URL.
- Six extractors ran in parallel: WARC (raw HTTP), Readability JSON (article text), PDF, PNG screenshot, DOM snapshot, and SingleFile (self-contained HTML).
- All outputs were saved to `./data/` and indexed in `archive.db`.

The whole thing used **one browser navigation** and **one shared HTTP cache** — that is why it is fast.

---

## 5. List your snapshots

```bash
WEBFROST_DIR=./data bun run webfrost list
# ID       URL                    Date
# abc123   https://example.com    2024-01-15 10:23:01
```

---

## 6. Search archived content

WebFrost indexes the extracted text with SQLite FTS5, so you can search immediately:

```bash
WEBFROST_DIR=./data bun run webfrost search "illustrative examples"
# abc123   https://example.com    score: 1.42
#   "...This domain is for use in <mark>illustrative examples</mark>..."
```

---

## 7. Try the web UI (optional)

If you want a browser interface instead of the CLI:

```bash
bun run build                  # Build UI assets (required once)
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
```

Open `http://localhost:3000`. The first-run wizard prompts you to create an admin account. After that you can archive, search, and browse snapshots from the UI.

---

## What's next?

- **Archive more URLs in bulk** → [How-to: Bulk import](../how-to/bulk-import.md)
- **Schedule recurring archives** → [How-to: Scheduled archives](../how-to/scheduled-archives.md)
- **Run it as a persistent server with Docker** → [How-to: Docker deploy](../how-to/docker-deploy.md)
- **Full CLI command reference** → [Reference: CLI](../reference/cli.md)
- **Understand how the pipeline works** → [Explanation: Pipeline](../explanation/pipeline.md)
