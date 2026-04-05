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
  ghcr.io/<org>/webfrost/server:latest
```

Then create the admin user (first run only):

```bash
docker exec <container-id> \
  webfrost admin create --username admin --password <your-password>
```

Open `http://localhost:3000`.

---

## Docker Compose (recommended for self-hosted)

A `docker-compose.prod.yml` is included in the repo root:

```bash
# Copy and edit the env file
cp .env.example .env
# Edit SESSION_SECRET and WEBFROST_DIR

docker compose -f docker-compose.prod.yml up -d
```

The Compose file runs the server with a named volume for data persistence. Review it and adjust volume paths for your setup.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBFROST_DIR` | Yes | — | Directory for the database and archive files (mount a volume here) |
| `SESSION_SECRET` | Yes | — | Random string ≥ 32 chars. Generate with `openssl rand -hex 32`. |
| `AUTH_DISABLED` | No | `false` | Skip auth entirely. **Never use in production.** |
| `WEBFROST_CONCURRENCY` | No | `3` | Max parallel archive pipelines |
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

## Production notes

- Run behind a reverse proxy (nginx, Caddy, Traefik) to handle TLS.
- Set `SESSION_SECRET` from a secret manager — do not hardcode it.
- `AUTH_DISABLED=true` is only for local development. Never expose it publicly.
- The schedule worker is embedded in the server — no separate worker process needed.

See [docs/DEPLOY.md](../DEPLOY.md) for the full CI/CD pipeline and release workflow.
