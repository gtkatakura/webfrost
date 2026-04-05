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
# Set SESSION_SECRET and WEBFROST_DIR in .env

# Start
docker compose -f docker-compose.prod.yml up -d
```

Create the admin user (first time only):

```bash
docker compose -f docker-compose.prod.yml exec server \
  webfrost admin create --username admin --password <your-password>
```

## Reverse proxy

Run WebFrost behind nginx, Caddy, or Traefik for TLS. Example Caddyfile:

```caddyfile
archive.example.com {
  reverse_proxy localhost:3000
}
```

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
- Restrict access to the container port — WebFrost has no rate limiting built in.
- The schedule worker runs inside the server container — no extra process needed.

## Full deployment docs

See `docs/DEPLOY.md` in the repo for the full CI/CD pipeline and release workflow.
