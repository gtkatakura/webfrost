---
title: Docker setup
description: Run WebFrost as a persistent server using Docker or Docker Compose.
---

# Docker setup

Run WebFrost as a persistent server with the web UI, REST API, and schedule worker.

## Quick start

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v /path/to/local/data:/data \
  ghcr.io/gtkatakura/webfrost/server:latest
```

Create the admin user (run once):

```bash
docker exec <container-id> \
  webfrost admin create --username admin --password <your-password>
```

Open `http://localhost:3000`.

## Docker Compose (recommended)

A `docker-compose.prod.yml` is in the repo root:

```bash
cp .env.example .env
# Edit SESSION_SECRET and WEBFROST_DIR in .env

docker compose -f docker-compose.prod.yml up -d
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBFROST_DIR` | Yes | — | Archive directory. Mount a volume here. |
| `SESSION_SECRET` | Yes | — | Random string ≥ 32 chars. `openssl rand -hex 32` |
| `AUTH_DISABLED` | No | `false` | Skip auth. **Never use in production.** |
| `WEBFROST_CONCURRENCY` | No | `3` | Max parallel archive pipelines |
| `WEBFROST_LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

Full reference: [Configuration](/reference/configuration)

## Data persistence

All data — the SQLite database and archive files — lives in `WEBFROST_DIR`. Mount a volume there to keep your archive across restarts:

```bash
-v /path/to/local/data:/data
```

Back up this directory to preserve your archive.

## Health check

```bash
curl http://localhost:3000/health
# { "status": "ok" }
```

This endpoint is unauthenticated and suitable for load balancer health checks.

## Production notes

- Run behind a reverse proxy (nginx, Caddy, Traefik) to handle TLS.
- Set `SESSION_SECRET` from a secrets manager — do not hardcode it.
- The schedule worker is embedded in the server — no separate process needed.
- `AUTH_DISABLED=true` is only for local development.
