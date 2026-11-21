---
title: Docker setup
description: Run WebFrost as a persistent server using Docker or Docker Compose.
---

# Docker setup

Run WebFrost as a persistent server with the web UI, REST API, and scheduler.

## Quick start

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v /path/to/local/data:/data \
  ghcr.io/gtkatakura/webfrost/server:latest
```

Open `http://localhost:3000` and create the admin user in the setup wizard on first visit (or via `POST /api/setup`). The image does not contain the `webfrost` CLI, so `webfrost admin create` cannot be run inside the container.

The image bundles Chromium, `yt-dlp` and `ffmpeg`, sets `WEBFROST_DIR=/data` (a declared volume) and has a built-in `HEALTHCHECK`.

## Docker Compose (recommended)

A `docker-compose.prod.yml` is in the repo root:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.prod.yml up -d
```

Compose reads `SESSION_SECRET` (required), `WEBFROST_TRUST_PROXY`, `WEBFROST_CONCURRENCY`, `TZ` and the storage variables from `.env`.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBFROST_DIR` | No | `/data` | Archive directory. Preset by the image; mount a volume at `/data`. |
| `SESSION_SECRET` | Yes | — | Random string ≥ 32 chars. `openssl rand -hex 32` |
| `AUTH_DISABLED` | No | `false` | Skip auth. **Never use in production.** |
| `WEBFROST_CONCURRENCY` | No | `3` | Max parallel archive pipelines |
| `WEBFROST_TRUST_PROXY` | No | `false` | `true` behind a reverse proxy, so rate limits use `X-Forwarded-For` |
| `TZ` | No | `UTC` | Time zone for cron expressions in schedules |
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
- The scheduler is embedded in the server — no separate process needed (`WEBFROST_SCHEDULER=false` disables it).
- `AUTH_DISABLED=true` is only for local development.

## Troubleshooting

Logging in over plain HTTP on a LAN address bounces back to the login page: the session cookie is `Secure` and browsers drop it on non-localhost HTTP origins. Use TLS, or set `WEBFROST_INSECURE_COOKIES=true`.
