# Reference: Environment Variables

All environment variables recognized by WebFrost.

---

## Core / CLI

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Directory for the SQLite database (`archive.db`) and all archive files. Mount a persistent volume here in Docker. |
| `WEBFROST_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. Overridden by `--verbose` / `--quiet` CLI flags. |
| `WEBFROST_CONCURRENCY` | `3` | Max number of archive pipelines running in parallel. Applies to the import command, schedule worker, and server. |

---

## Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | — | Secret used to sign session cookies. Must be a random string ≥ 32 characters. Generate with `openssl rand -hex 32`. Never reuse across environments. |
| `AUTH_DISABLED` | No | `false` | Set to `true` to disable all authentication. **Development only. Never expose to the public internet.** |

---

## Storage

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | Storage backend: `filesystem` or `s3`. |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL (e.g. `https://s3.amazonaws.com`, `http://localhost:9000`). Required when `WEBFROST_STORAGE_BACKEND=s3`. |
| `S3_BUCKET` | — | S3 bucket name. Required when backend is `s3`. |
| `S3_ACCESS_KEY` | — | S3 access key ID. Required when backend is `s3`. |
| `S3_SECRET_KEY` | — | S3 secret access key. Required when backend is `s3`. |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_PATH_PREFIX` | `snapshots` | Object key prefix inside the bucket. |

---

## Setting variables

**CLI / development:**

```bash
WEBFROST_DIR=./data WEBFROST_LOG_LEVEL=debug bun run webfrost add https://example.com
```

**Server:**

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
export WEBFROST_DIR=/data
export WEBFROST_CONCURRENCY=5
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

**Docker Compose (`.env` file):**

Copy `.env.example` to `.env` and fill in the values. Docker Compose picks it up automatically.

---

## `.env.example`

See the [`.env.example`](../../.env.example) in the repo root for a template with all variables and descriptions.
