---
title: Configuration
description: All environment variables for WebFrost CLI, server, and storage.
---

# Configuration

All configuration is via environment variables. There is no config file.

## Core / CLI

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Directory for `archive.db` and all archive files. Mount a persistent volume here in Docker. |
| `WEBFROST_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. Overridden by `--verbose` / `--quiet`. |
| `WEBFROST_CONCURRENCY` | `3` | Max archive pipelines running in parallel. Applies to import, schedule worker, and server. |

## Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | — | Secret for signing session cookies. Random string ≥ 32 chars. Generate: `openssl rand -hex 32`. Never reuse across environments. |
| `AUTH_DISABLED` | No | `false` | Disable all authentication. **Development only. Never expose publicly.** |

## Storage

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3` |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL. Required when `WEBFROST_STORAGE_BACKEND=s3`. |
| `S3_BUCKET` | — | S3 bucket name. Required when backend is `s3`. |
| `S3_ACCESS_KEY` | — | S3 access key ID. Required when backend is `s3`. |
| `S3_SECRET_KEY` | — | S3 secret access key. Required when backend is `s3`. |
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

**Docker Compose:** Copy `.env.example` to `.env` and fill in values. Docker Compose loads it automatically.

## Storage backends

See [Storage backends](/guides/storage-backends) for full setup instructions for S3-compatible providers.
