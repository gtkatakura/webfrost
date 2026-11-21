# How-to: Deploy with Docker

Run WebFrost as a persistent server using Docker or Docker Compose.

For the full CI/CD pipeline, deployment targets, and release process, see [docs/DEPLOY.md](../DEPLOY.md).

---

## Quick start (single container)

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v /path/to/local/data:/data \
  ghcr.io/gtkatakura/webfrost/server:latest
```

Open `http://localhost:3000` and create the admin user in the setup wizard on first visit (or call `POST /api/setup`). The image does not contain the `webfrost` CLI, so `webfrost admin create` cannot be run inside the container.

The image bundles Chromium (Playwright headless shell), `yt-dlp` and `ffmpeg`, so every extractor works out of the box. It sets `WEBFROST_DIR=/data`, declares `/data` as a volume and has a built-in `HEALTHCHECK`.

---

## Docker Compose (recommended for self-hosted)

A `docker-compose.prod.yml` is included in the repo root:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.prod.yml up -d
```

Compose reads `.env` and substitutes `${VAR}` in the file. `SESSION_SECRET` is required; `WEBFROST_TRUST_PROXY`, `WEBFROST_CONCURRENCY`, `TZ` and the storage variables (`WEBFROST_STORAGE_BACKEND`, `S3_*`) are optional. The image name defaults to `ghcr.io/gtkatakura/webfrost/server`. Data lives in a named volume mounted at `/data`; review the file and adjust it for your setup.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBFROST_DIR` | No | `/data` | Directory for the database and archive files. Preset by the image; mount a volume at `/data`. |
| `SESSION_SECRET` | Yes | — | Random string ≥ 32 chars. Generate with `openssl rand -hex 32`. |
| `AUTH_DISABLED` | No | `false` | Skip auth entirely. **Never use in production.** |
| `WEBFROST_CONCURRENCY` | No | `3` | Max parallel archive pipelines |
| `WEBFROST_TRUST_PROXY` | No | `false` | Set to `true` behind a reverse proxy so rate limits use `X-Forwarded-For` |
| `TZ` | No | `UTC` | Time zone for cron expressions in schedules |
| `WEBFROST_LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

All environment variables are documented in [Reference: Environment variables](../reference/environment-variables.md).

---

## Persisting data

Mount a volume at `WEBFROST_DIR` to keep your archive across container restarts. The entire archive — database and files — lives in that one directory.

```bash
-v /path/to/local/data:/data
```

Back up this directory to preserve your archive.

---

## Health check

```bash
curl http://localhost:3000/health
# { "status": "ok" }
```

This endpoint is unauthenticated and suitable for load balancer health checks.

---

## Troubleshooting

**Logging in over plain HTTP on a LAN address bounces back to the login page.** The session cookie is `Secure`, and browsers drop it on HTTP origins other than `localhost`. Serve WebFrost over TLS (recommended), or set `WEBFROST_INSECURE_COOKIES=true` for an HTTP-only deployment.

---

## Production notes

- Run behind a reverse proxy (nginx, Caddy, Traefik) to handle TLS.
- Set `SESSION_SECRET` from a secret manager — do not hardcode it.
- `AUTH_DISABLED=true` is only for local development. Never expose it publicly.
- The scheduler is embedded in the server (polls every 30 s) — no separate worker process needed. Set `WEBFROST_SCHEDULER=false` to turn it off.
- Behind a reverse proxy, set `WEBFROST_TRUST_PROXY=true` so rate limiting sees client addresses instead of the proxy's.

See [docs/DEPLOY.md](../DEPLOY.md) for the full CI/CD pipeline and release workflow.
