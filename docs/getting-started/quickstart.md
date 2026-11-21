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
# Snapshot 1 archived.
```

All extractors run in parallel. The snapshot is saved to `./data/` and its status is `done` when at least one extractor produced output.

## 4. List snapshots

```bash
WEBFROST_DIR=./data bun run webfrost list
# 1    done    https://example.com
```

## 5. Search

```bash
WEBFROST_DIR=./data bun run webfrost search "illustrative"
# 1    https://example.com
#   "...This domain is for use in <mark>illustrative</mark> examples..."
```

## What's next?

- **Try the web UI** → [Getting started with Docker](/getting-started/docker)
- **Import many URLs at once** → [Bulk import](/guides/bulk-import)
- **Schedule recurring archives** → [Scheduled archiving](/guides/scheduled-archiving)
- **Full CLI reference** → [CLI reference](/reference/cli)
