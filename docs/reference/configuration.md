---
title: Configuration
description: All environment variables for WebFrost CLI, server, and storage.
---

# Configuration

All configuration is via environment variables. There is no config file.

## Core / CLI

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Directory for the SQLite database (`archive.db`) and all archive files. The Docker image sets it to `/data` (a declared volume). |
| `WEBFROST_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. Controls both the CLI (overridden by `--verbose` / `--quiet`) and the server. The server falls back to `LOG_LEVEL` when `WEBFROST_LOG_LEVEL` is unset. |
| `WEBFROST_CONCURRENCY` | `3` | Max archive pipelines running in parallel (server job runner, `import`, `schedule worker`). Each running pipeline can launch its own headless Chromium. |

## Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port the server listens on. |
| `SESSION_SECRET` | Yes | — | Secret used to sign session cookies. Must be a random string ≥ 32 characters. Generate with `openssl rand -hex 32`. Never reuse across environments. Required unless `AUTH_DISABLED=true`. |
| `AUTH_DISABLED` | No | `false` | Set to `true` to disable all authentication. **Development only. Never expose to the public internet.** |
| `WEBFROST_TRUST_PROXY` | No | `false` | Set to `true` only behind a reverse proxy that sets `X-Forwarded-For`. Without it the header is ignored and rate limits are keyed on the TCP peer address. |
| `WEBFROST_PUBLIC_READ` | No | `false` | Let anonymous visitors browse the archive read-only: list, search and view snapshots, tags, stats and archived files. Every write, and schedules, imports, settings and API keys, still require signing in. |
| `WEBFROST_INSECURE_COOKIES` | No | `false` | Drops the `Secure` flag from the session cookie. Needed only for HTTP-only deployments on a non-localhost address (e.g. a LAN IP), where browsers otherwise discard the cookie. Prefer TLS. |
| `WEBFROST_SCHEDULER` | No | enabled | The server runs due schedules itself (polling every 30 s). Set to `false` to disable this when a separate `webfrost schedule worker` should be the only process doing it. |
| `TZ` | No | system time zone (`UTC` in Docker) | Time zone used to evaluate cron expressions in schedules. |

## Pipeline

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_FETCH_TIMEOUT_MS` | `30000` | Timeout for the initial page fetch. |
| `WEBFROST_EXTRACTOR_TIMEOUT_MS` | `60000` | Timeout for each extractor. An extractor that exceeds it is recorded as failed. |
| `WEBFROST_MEDIA_TIMEOUT_MS` | `600000` | Timeout for each `yt-dlp` run (a media archive can run it up to three times). |
| `WEBFROST_DOMAIN_DELAY_MS` | `1000` | Minimum gap between two archives of the same hostname. `0` disables the delay. |
| `WEBFROST_CHROMIUM_PATH` | — | Path to an existing Chromium/Chrome binary to use instead of the build Playwright downloads. |
| `WEBFROST_ALLOW_PRIVATE_URLS` | `false` | Set to `true` to allow archiving loopback, private and link-local addresses (intranet archiving). Leave unset when users you do not fully trust can submit URLs. See [Security](/SECURITY). |

Browser navigation has a fixed 30 s timeout that is not configurable.

## Storage

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3` |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL. Required when `WEBFROST_STORAGE_BACKEND=s3`. |
| `S3_BUCKET` | — | S3 bucket name. Required when backend is `s3`. |
| `S3_ACCESS_KEY_ID` | — | S3 access key ID. Required when backend is `s3`. |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret access key. Required when backend is `s3`. |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_PATH_PREFIX` | `snapshots` | Object key prefix inside the bucket. |

## Setting variables

**CLI / development:**

```bash
WEBFROST_DIR=./data WEBFROST_LOG_LEVEL=debug bun run webfrost add https://example.com
```

**Server:**

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
export WEBFROST_DIR=/data
bun run packages/server/src/index.ts
```

**Docker:**

```bash
docker run \
  -e WEBFROST_DIR=/data \
  -e SESSION_SECRET=<secret> \
  -e WEBFROST_CONCURRENCY=5 \
  ...
```

**Docker Compose:** `docker-compose.prod.yml` substitutes `${VAR}` from `.env`: `SESSION_SECRET` is required, and `WEBFROST_TRUST_PROXY`, `WEBFROST_CONCURRENCY`, `TZ` and the storage variables are optional. Quick start: `echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env`.

## Storage backends

See [Storage backends](/guides/storage-backends) for full setup instructions for S3-compatible providers.
