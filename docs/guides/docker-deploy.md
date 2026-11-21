---
title: Docker deploy
description: Run WebFrost as a production server with Docker or Docker Compose.
---

# Docker deploy

Run WebFrost as a persistent server using Docker or Docker Compose.

For a quick local setup, see [Docker setup](/getting-started/docker). This guide covers production deployment considerations.

## Docker Compose (recommended)

```bash
# Clone the repo
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost

# Configure environment
cp .env.example .env
# Set SESSION_SECRET in .env (required): openssl rand -hex 32
# Or in one step: echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env

# Start
docker compose -f docker-compose.prod.yml up -d
```

Open `http://localhost:3000` and create the admin user in the setup wizard on first visit (or via `POST /api/setup`). The image does not contain the `webfrost` CLI, so `webfrost admin create` cannot be run inside the container.

The image bundles Chromium, `yt-dlp` and `ffmpeg`, sets `WEBFROST_DIR=/data` (a declared volume) and has a built-in `HEALTHCHECK`. The compose file reads `SESSION_SECRET` (required), `WEBFROST_TRUST_PROXY`, `WEBFROST_CONCURRENCY`, `TZ` and the storage variables from `.env`.

## Reverse proxy

Run WebFrost behind nginx, Caddy, or Traefik for TLS. Example Caddyfile:

```caddyfile
archive.example.com {
  reverse_proxy localhost:3000
}
```

Behind a proxy, set `WEBFROST_TRUST_PROXY=true` so rate limits are keyed on the client address from `X-Forwarded-For` instead of the proxy's.

## Persistent volumes

Mount a volume at `WEBFROST_DIR` to keep your archive across container restarts:

```yaml
volumes:
  - /path/to/local/data:/data
```

Back up this directory to preserve your entire archive.

## Health check

```bash
curl http://localhost:3000/health
# { "status": "ok" }
```

## Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Security notes

- Set `SESSION_SECRET` from a secret manager, not a `.env` file in production.
- Never set `AUTH_DISABLED=true` in production.
- The API is rate limited per client IP (see [REST API](/reference/rest-api#rate-limits)), but still restrict access to the container port.
- The scheduler runs inside the server container — no extra process needed (`WEBFROST_SCHEDULER=false` disables it).
- See [Security](/SECURITY) for the hardening checklist.

## Troubleshooting

Logging in over plain HTTP on a LAN address bounces back to the login page: the session cookie is `Secure` and browsers drop it on non-localhost HTTP origins. Use TLS, or set `WEBFROST_INSECURE_COOKIES=true` for an HTTP-only deployment.

## Full deployment docs

See `docs/DEPLOY.md` in the repo for the full CI/CD pipeline and release workflow.
