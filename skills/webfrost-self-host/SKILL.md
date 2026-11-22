---
name: webfrost-self-host
description: Install, configure, secure, back up and troubleshoot a self-hosted WebFrost server (web archiver with web UI, HTTP API and scheduler), with Docker Compose or the webfrost binary, on SQLite, PostgreSQL or MySQL. Use when the user wants to run their own WebFrost, put it behind a reverse proxy, choose a database, set up backups, or fix a WebFrost deployment.
license: MIT
metadata:
  homepage: https://webfrost.dev
  source: https://github.com/gtkatakura/webfrost
---

# Running your own WebFrost

Documentation: https://webfrost.dev/docs. The pages to fetch for details are
[Deploy](https://webfrost.dev/docs/guides/deploy),
[Configuration](https://webfrost.dev/docs/reference/configuration),
[Security](https://webfrost.dev/docs/architecture/security),
[Backups](https://webfrost.dev/docs/guides/backups) and
[Troubleshooting](https://webfrost.dev/docs/guides/troubleshooting).

## Install

**Docker Compose** (recommended for a server; the image has Chromium, yt-dlp and ffmpeg, amd64 and
arm64, runs as UID 1000):

```bash
curl -fsSLO https://webfrost.dev/compose.yml
[ -f .env ] || echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
curl -fsS http://localhost:3000/health      # {"status":"ok"}
```

**The binary** (a laptop or a small machine without Docker):

```bash
curl -fsSL https://webfrost.dev/install.sh | sh   # or: brew install gtkatakura/tap/webfrost
webfrost setup     # headless Chromium if none is installed
webfrost doctor    # what is missing (yt-dlp and ffmpeg are optional, for video)
webfrost serve     # API, web UI and scheduler on :3000
```

Then open the web UI and create the admin user. On a machine reachable by others, set
`WEBFROST_SETUP_TOKEN` before the first start: the setup page asks for it, so nobody else can claim
the fresh instance.

## Configuration that matters

| Variable | Why |
|---|---|
| `SESSION_SECRET` | Required by the Docker server; 32+ random characters. Changing it signs everyone out. `webfrost serve` generates one in `<WEBFROST_DIR>/session-secret` when unset. |
| `WEBFROST_DIR` | Archive folder (`~/.webfrost` for the binary, `/data` in Docker). Back this up. |
| `DATABASE_URL` | `postgres://…` or `mysql://…`; unset means SQLite in `WEBFROST_DIR`. |
| `WEBFROST_STORAGE_BACKEND` | `filesystem` (default) or `s3` with the `S3_*` variables. |
| `WEBFROST_TRUST_PROXY` | `true` only behind a reverse proxy; `WEBFROST_TRUSTED_PROXY_HOPS` if more than one. |
| `WEBFROST_PUBLIC_READ` | `true` lets anyone browse and search; writes still need a login. |
| `WEBFROST_CONCURRENCY` | Archives in parallel; each runs a headless Chromium (plan ~300–500 MB RAM each). |
| `HOST` / `PORT` | Listen address; with `AUTH_DISABLED=true` the server binds 127.0.0.1 only. |

Never set `AUTH_DISABLED=true` on anything reachable from a network.

## Choosing a database

- **SQLite** (default): one person or a small team on one server. Nothing to run. Back it up
  continuously with Litestream: `docker compose --profile backup up -d`
  after setting the `LITESTREAM_*` variables (see the Backups guide). WebFrost keeps SQLite in WAL mode
  and never checkpoints by hand, which is what Litestream needs.
- **PostgreSQL** or **MySQL 8.0.13+**: when a database server already exists, for managed backups, or to run
  several WebFrost servers against one database. Set `DATABASE_URL`; migrations run at startup.

## Reverse proxy and TLS

Put Caddy, nginx or Traefik in front, terminate TLS there, set `WEBFROST_TRUST_PROXY=true`, and keep
the `Host` header (the server compares `Origin` with `Host` to reject cross-site writes). Session
cookies are `Secure`; on plain HTTP over a LAN address set `WEBFROST_INSECURE_COOKIES=true`.

## Security checklist

Full operator checklist: https://webfrost.dev/docs/guides/harden-a-deployment

1. Strong `SESSION_SECRET`, `WEBFROST_SETUP_TOKEN` until the admin exists.
2. Leave `WEBFROST_ALLOW_PRIVATE_URLS` off unless archiving an intranet on purpose.
3. If untrusted people can submit URLs, block egress to private ranges and `169.254.169.254` at the
   network level too (the app-level SSRF guard is one layer).
4. Keep the image or binary updated; watch the GitHub releases.

## Backups and restore

- Files: back up `WEBFROST_DIR` (database plus snapshot folders), or the S3 bucket.
- SQLite: Litestream for continuous copies; restore with `litestream restore` into an empty data
  folder while WebFrost is stopped.
- PostgreSQL / MySQL: `pg_dump` / `mysqldump` on a schedule.
- Test a restore once; a backup never restored is a guess.

## Troubleshooting

- `docker compose logs -f webfrost` (or the `serve` output); `WEBFROST_LOG_LEVEL=debug` for more.
- PDF, screenshot and DOM missing on every snapshot: Chromium is not available (`webfrost doctor`).
- No video: yt-dlp/ffmpeg missing, or the site is not one yt-dlp supports.
- `SSRF blocked` in a snapshot's errors: the URL resolves to a private address.
- Login fails over plain HTTP on a LAN IP: see `WEBFROST_INSECURE_COOKIES` above.
- Permission errors on `/data` in Docker: the volume must be writable by UID 1000.
