---
title: Quickstart
description: Archive your first page with WebFrost in under 5 minutes.
---

# Quickstart

Archive your first page in under 5 minutes.

**Requirements:** [Bun](https://bun.sh) v1.x, Chromium (for PDF/screenshot)

## 1. Clone and install

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
bun install
```

## 2. Initialize an archive

```bash
mkdir -p ./data
WEBFROST_DIR=./data bun run webfrost init
# Initialized archive at ./data
```

## 3. Archive a URL

```bash
WEBFROST_DIR=./data bun run webfrost add https://example.com
# Archiving https://example.com...
# ✓ snapshot abc123 — warc, pdf, screenshot, readability, dom-snapshot, singlefile
```

All six extractors run in parallel. The snapshot is saved to `./data/`.

## 4. List snapshots

```bash
WEBFROST_DIR=./data bun run webfrost list
# ID       URL                    Date
# abc123   https://example.com    2024-01-15 10:23:01
```

## 5. Search

```bash
WEBFROST_DIR=./data bun run webfrost search "illustrative"
# abc123   https://example.com    score: 1.42
#   "...This domain is for use in <mark>illustrative</mark> examples..."
```

## What's next?

- **Try the web UI** → [Getting started with Docker](/getting-started/docker)
- **Import many URLs at once** → [Bulk import](/guides/bulk-import)
- **Schedule recurring archives** → [Scheduled archiving](/guides/scheduled-archiving)
- **Full CLI reference** → [CLI reference](/reference/cli)
