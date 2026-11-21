---
title: Troubleshooting
description: Common issues and fixes for WebFrost.
---

# Troubleshooting

## Chromium extractors are skipped

**Symptom:** Snapshot completes but no PDF, screenshot, DOM snapshot, or SingleFile output.

**Cause:** Chromium is not installed or not found by Playwright, navigation failed, or the URL was blocked by the SSRF policy. Those extractors show up as `status: "failed"` with an `error` in the API's `extractorMeta` (`GET /api/snapshots/:id`) — check the message.

**Fix:**

```bash
bunx playwright install chromium
```

To use a Chromium or Chrome you already have, set `WEBFROST_CHROMIUM_PATH=/usr/bin/chromium`. The Docker image bundles Chromium.

Or install via system package manager (see [Installation](/getting-started/install)).

## yt-dlp media extraction is skipped

**Symptom:** No `media` or `media-metadata` output for a YouTube/Vimeo URL.

**Cause:** `yt-dlp` is not installed, or the URL is not a media page. Media extraction is skipped silently in both cases. The Docker image bundles `yt-dlp` and `ffmpeg`.

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

**Symptom:** Server exits immediately with a secret error. (With Docker Compose, `docker-compose.prod.yml` refuses to start until `SESSION_SECRET` is set in `.env`.)

**Fix:** Set a random `SESSION_SECRET`:

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
```

## `database is locked` errors

**Cause:** Several processes write to the same SQLite database. Connections wait up to 5 s for a competing writer (`busy_timeout`), so running the server and a CLI command or `schedule worker` on one archive is fine; the error appears only when a writer is blocked for longer, or a previous process did not shut down cleanly.

**Fix:**

1. Check for a stuck process holding the database open.
2. If the error persists after a clean shutdown, the database WAL file may be stuck. Run:
   ```bash
   sqlite3 ./data/archive.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```

## Login bounces back to the login page

**Symptom:** Login appears to succeed, then you land on the login page again. Typical when opening `http://<lan-ip>:3000`.

**Cause:** The session cookie is `Secure`, and browsers drop it on plain-HTTP origins other than `localhost`.

**Fix:** Serve WebFrost over TLS (reverse proxy), or for an HTTP-only deployment set `WEBFROST_INSECURE_COOKIES=true`.

## Snapshots stay `pending` or end `failed`

**Symptom:** A snapshot never leaves `pending`, or ends `failed`.

**Cause:** Archives run through a background job runner limited to `WEBFROST_CONCURRENCY` pipelines (default 3), so a burst of submissions queues up. A snapshot is `failed` when the page could not be fetched (timeout `WEBFROST_FETCH_TIMEOUT_MS`, HTTP error, SSRF policy) or no extractor produced output. Snapshots left `pending` by a crash or restart are re-queued automatically at server startup.

**Fix:** Raise `WEBFROST_CONCURRENCY` if the machine can take it, run with `WEBFROST_LOG_LEVEL=debug` to see why a fetch failed, and set `WEBFROST_ALLOW_PRIVATE_URLS=true` if you intend to archive intranet addresses.

## `429 Too Many Requests`

**Cause:** The API rate limits per client IP (see [REST API](/reference/rest-api#rate-limits)). Behind a reverse proxy every client shares the proxy's address unless `WEBFROST_TRUST_PROXY=true`.

**Fix:** Wait for the `Retry-After` period, and set `WEBFROST_TRUST_PROXY=true` when running behind a proxy that sets `X-Forwarded-For`.

## Schedules do not run

**Cause:** The scheduler is disabled (`WEBFROST_SCHEDULER=false`) with no `webfrost schedule worker` running, or the cron expression is evaluated in a different time zone than you expect (the process time zone, `TZ`; UTC in Docker).

**Fix:** Remove `WEBFROST_SCHEDULER=false` or start a worker, and set `TZ` if needed.

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
