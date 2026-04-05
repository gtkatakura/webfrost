---
title: Storage backends
description: Configure WebFrost to store archive files on the local filesystem or S3-compatible object storage.
---

# Storage backends

WebFrost supports two storage backends for archive files:

- **filesystem** (default) — files stored in `WEBFROST_DIR` on the local disk.
- **s3** — files stored in an S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.).

The SQLite database (`archive.db`) always remains local regardless of backend.

## Filesystem (default)

No configuration needed. Files are written to `WEBFROST_DIR/<snapshot-id>/`.

```bash
WEBFROST_DIR=./data webfrost add https://example.com
# Files written to ./data/abc123/
```

## S3-compatible storage

Set `WEBFROST_STORAGE_BACKEND=s3` and the required S3 variables:

```bash
WEBFROST_STORAGE_BACKEND=s3 \
S3_ENDPOINT=https://s3.amazonaws.com \
S3_BUCKET=my-webfrost-bucket \
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE \
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
S3_REGION=us-east-1 \
WEBFROST_DIR=./data \
bun run packages/server/src/index.ts
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3` |
| `S3_ENDPOINT` | — | S3 endpoint URL. Required when `s3`. |
| `S3_BUCKET` | — | Bucket name. Required when `s3`. |
| `S3_ACCESS_KEY` | — | Access key ID. Required when `s3`. |
| `S3_SECRET_KEY` | — | Secret access key. Required when `s3`. |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_PATH_PREFIX` | `snapshots` | Object key prefix inside the bucket. |

### Local dev with MinIO

A `docker-compose.dev.yml` in the repo root spins up a local MinIO instance:

```bash
docker compose -f docker-compose.dev.yml up -d

WEBFROST_STORAGE_BACKEND=s3 \
S3_ENDPOINT=http://localhost:9000 \
S3_BUCKET=webfrost \
S3_ACCESS_KEY=minioadmin \
S3_SECRET_KEY=minioadmin \
WEBFROST_DIR=./data SESSION_SECRET=$(openssl rand -hex 32) \
bun run packages/server/src/index.ts
```

MinIO console: `http://localhost:9001` (minioadmin / minioadmin).

### Other S3-compatible providers

| Provider | Endpoint |
|---|---|
| AWS S3 | `https://s3.amazonaws.com` (or `https://s3.<region>.amazonaws.com`) |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` |
| MinIO (self-hosted) | Your MinIO URL, e.g. `http://localhost:9000` |
| Hetzner Storage Box | `https://<region>.your-objectstorage.com` |
