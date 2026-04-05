---
title: Troubleshooting
description: Common issues and fixes for WebFrost.
---

# Troubleshooting

## Chromium extractors are skipped

**Symptom:** Snapshot completes but no PDF, screenshot, DOM snapshot, or SingleFile output.

**Cause:** Chromium is not installed or not found by Playwright.

**Fix:**

```bash
bunx playwright install chromium
```

Or install via system package manager (see [Installation](/getting-started/install)).

## yt-dlp media extraction is skipped

**Symptom:** No `media` or `media-metadata` output for a YouTube/Vimeo URL.

**Cause:** `yt-dlp` is not installed.

**Fix:**

```bash
# macOS
brew install yt-dlp

# pip
pip install yt-dlp
```

## `bun: command not found`

**Cause:** Bun is not installed or not on `PATH`.

**Fix:** Install Bun from [bun.sh](https://bun.sh) and ensure `~/.bun/bin` is on your `PATH`.

If you use [mise](https://mise.jdx.dev/), run commands with `mise exec bun --`:

```bash
mise exec bun -- bun run webfrost add https://example.com
```

## `WEBFROST_DIR` not set

**Symptom:** `Error: WEBFROST_DIR is not set` or archive stored in wrong location.

**Fix:** Always pass `WEBFROST_DIR` when running the CLI:

```bash
WEBFROST_DIR=./data webfrost add https://example.com
```

## Server fails to start: `SESSION_SECRET is not set`

**Symptom:** Server exits immediately with a secret error.

**Fix:** Set a random `SESSION_SECRET`:

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
```

## `database is locked` errors

**Cause:** Multiple processes writing to the same SQLite database simultaneously, or a previous process did not shut down cleanly.

**Fix:**

1. Ensure only one server/CLI process is running against `WEBFROST_DIR`.
2. If the error persists after a clean shutdown, the database WAL file may be stuck. Run:
   ```bash
   sqlite3 ./data/archive.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```

## Search returns no results after import

**Symptom:** `webfrost search` returns nothing even though snapshots exist.

**Cause:** The FTS index may be out of sync.

**Fix:**

```bash
WEBFROST_DIR=./data webfrost search:rebuild
```




## Enable debug logging

```bash
WEBFROST_LOG_LEVEL=debug webfrost add https://example.com
# or
webfrost --verbose add https://example.com
```

Debug output shows each extractor start/finish time, HTTP cache hits, and any errors.
