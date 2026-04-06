# Deploy Path — WebFrost

This document describes the deploy targets and pipeline for WebFrost. It is maintained by DevOps and must be updated when any step changes.

---

## CI Pipeline (every PR and `main` push)

File: `.github/workflows/ci.yml`

| Step | Command | Notes |
|------|---------|-------|
| Install deps | `bun install --frozen-lockfile` | Bun dep cache keyed on `bun.lock` |
| Lint | `bun run lint` | Biome check |
| Typecheck | `bun run typecheck` | `tsc --noEmit` |
| Test | `bun test` | All workspace packages |
| Playwright browsers | `bunx playwright install --with-deps chromium` | Cached per `bun.lock` hash |
| Bench (PR) | `bun run bench` | 5-min timeout, `continue-on-error: true` |
| Bench (main) | `bun run bench` | Full suite, results uploaded as artifact |

**Bench artifacts** are uploaded on `main` pushes and retained for 90 days under `bench-results-<sha>`. Baseline numbers should be documented in `bench/BASELINE.md` (created by the first full bench run on main).

---

## Deploy Targets

### 1. Docker → GitHub Container Registry (GHCR)

**Image:** `ghcr.io/<org>/webfrost/server`

**Triggers:**
- Push a semver tag (e.g. `v0.1.0`) — tags image as `v<semver>`, `<major>.<minor>`, and `sha-<sha>`.
- Merge to `main` — tags image as `latest` and `sha-<sha>`.
- Manual dispatch in GitHub Actions with target `docker-ghcr`.

**Steps (automated via `.github/workflows/release.yml`):**

1. CI gate passes (lint, typecheck, test).
2. GHCR login via `GITHUB_TOKEN` (no extra secret needed).
3. Docker image built from `packages/server/Dockerfile` (multi-stage: UI → server → runtime).
4. Layer cache via GitHub Actions cache (`cache-from/to: type=gha`).
5. **Visual verification** — the `verify-docker` job starts the freshly pushed container and runs Playwright against it (see [Post-Deploy Visual Verification](#post-deploy-visual-verification) below).

**Dockerfile stages:**

| Stage | Base | What it does |
|-------|------|--------------|
| `ui-builder` | `oven/bun:1` | Builds `@webfrost/ui` with Vite → `packages/ui/dist/` |
| `server-builder` | `oven/bun:1` | Builds `@webfrost/core` + `@webfrost/server` → `packages/server/dist/` |
| runtime | `oven/bun:1-slim` | Copies `dist/` (server bundle) and `public/` (UI assets) |

**To release a versioned image:**

```bash
git tag v0.1.0
git push origin v0.1.0
```

**To deploy latest from main:** just merge to `main` — CI gate + Docker push run automatically.

**Pulling the image:**

```bash
# Latest from main
docker pull ghcr.io/<org>/webfrost/server:latest

# Pinned version
docker pull ghcr.io/<org>/webfrost/server:v0.1.0
```

**Running with Docker Compose (recommended):**

A production-ready Compose file is at `docker-compose.prod.yml`. It mounts a named volume, sets `WEBFROST_DIR=/data`, and configures a health-check.

```bash
# Copy and customise env vars
cp .env.example .env
# Edit .env as needed, then start
docker compose -f docker-compose.prod.yml up -d
# Verify health
curl http://localhost:3000/health
# {"status":"ok"}
```

To pull a specific version, set `IMAGE_TAG` before starting:

```bash
IMAGE_TAG=v0.1.0 docker compose -f docker-compose.prod.yml up -d
```

**Running the container (single docker run):**

```bash
docker run -d \
  -p 3000:3000 \
  -e WEBFROST_DIR=/data \
  -v /path/to/local/data:/data \
  ghcr.io/<org>/webfrost/server:latest
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the server listens on |
| `WEBFROST_DIR` | `~/.webfrost` | Directory for SQLite database and archive files |
| `SESSION_SECRET` | — | **Required.** Random string ≥ 32 chars. Signs session cookies. Generate with `openssl rand -hex 32`. |
| `AUTH_DISABLED` | `false` | Set to `true` to bypass all auth checks. Dev/testing only — never in production. |
| `GITHUB_REPOSITORY` | `your-org/webfrost` | Used by `docker-compose.prod.yml` to construct the image name (`ghcr.io/$GITHUB_REPOSITORY/server`) |
| `IMAGE_TAG` | `latest` | Docker image tag to pull — set to a version like `v0.1.0` to pin a release |

See `.env.example` at the repo root for a template. Never commit `.env` to version control.

**Secrets handling:**

- Do not store secrets in the image or the Compose file.
- Inject runtime values via environment variables or Docker secrets.
- For CI/CD, use GitHub Actions repository secrets (Settings → Secrets).

**Volume mounts:**

| Container path | Purpose |
|----------------|---------|
| `/data` (or your `WEBFROST_DIR`) | Persists the SQLite database (`webfrost.db`) and snapshot archive files across container restarts |

> **Important:** always mount a volume for `WEBFROST_DIR`. Without it, all snapshots are lost when the container stops.

**API endpoints (served alongside UI):**

| Route | Description |
|-------|-------------|
| `GET /` | React UI (served as static files) |
| `GET /health` | Health check — returns `{"status":"ok"}` (unauthenticated) |
| `POST /api/auth/login` | Log in with username + password — sets session cookie |
| `POST /api/auth/logout` | Clear session cookie |
| `GET /api/auth/me` | Returns current authenticated username |
| `POST /api/snapshots` | Submit a URL for archiving |
| `GET /api/snapshots` | List all snapshots (supports `?q=` for full-text search) |
| `GET /api/snapshots/:id` | Get snapshot detail |
| `DELETE /api/snapshots/:id` | Delete a snapshot and its archive files |
| `GET /api/snapshots/:id/archives/:extractor/download` | Download raw archive file (extractor: `warc`, `pdf`, `readability`, `html`, `screenshot`, `dom-snapshot`, `singlefile`) |
| `POST /api/schedules` | Create a recurring archive schedule |
| `GET /api/schedules` | List all schedules |
| `DELETE /api/schedules/:id` | Remove a schedule |
| `GET /api/tags` | List all tags |
| `POST /api/tags` | Create a tag |
| `DELETE /api/tags/:id` | Delete a tag |
| `GET /api/snapshots/:id/tags` | List tags on a snapshot |
| `POST /api/snapshots/:id/tags` | Add a tag to a snapshot |
| `DELETE /api/snapshots/:id/tags/:tagId` | Remove a tag from a snapshot |

---

## Post-Deploy Visual Verification

After each Docker push, the `verify-docker` job in `release.yml` performs a browser-based smoke test against the pushed image. HTTP 200 alone is not sufficient — the job confirms the UI is actually rendered.

**What it does:**

1. Pulls the image tag `sha-<shortsha>` from GHCR.
2. Starts the container with `AUTH_DISABLED=true` and a throwaway `SESSION_SECRET`.
3. Waits up to 60 s for `GET /health` to return `{"status":"ok"}`.
4. Runs Playwright (Chromium) via `playwright.verify.config.ts` against `http://localhost:3000`:
   - Checks the page body is not blank.
   - Asserts at least one structural element (`h1`, `h2`, `nav`) is visible.
   - Captures JS console errors — test fails if any are detected.
   - Takes a full-page screenshot.
5. Uploads the screenshot as the artifact `deploy-screenshot-<sha>` (retained 90 days).
6. Stops and removes the container.

**Relevant files:**

| File | Purpose |
|------|---------|
| `packages/ui/e2e/verify-deploy.spec.ts` | Playwright test spec |
| `packages/ui/playwright.verify.config.ts` | Playwright config (no webServer, targets `VERIFY_URL`) |
| `.github/workflows/release.yml` → `verify-docker` job | CI wiring |

**If verification fails:**

- Check the `deploy-screenshot-<sha>` artifact for a visual — blank or error state is immediately obvious.
- Review the Playwright trace output in the job log for the failing assertion.
- Common causes: static asset build failure (blank page), JS bundle error (console errors), or startup race (health timeout).

---

## Auth Setup

WebFrost uses API key (Bearer token) and session cookie authentication. All `/api/*` routes require authentication except `POST /api/auth/login`.

### 1. Generate a session secret

```bash
openssl rand -hex 32
```

Set this as `SESSION_SECRET` in your environment or `.env` file.

### 2. Create the admin user

Use the `webfrost admin create` CLI command. This creates the admin user and generates a default API key in one step.

```bash
# With the CLI installed globally
webfrost admin create --username admin --password <your-password>

# Or from the repo directly
WEBFROST_DIR=/data bun run packages/cli/src/index.ts admin create --username admin --password <your-password>
```

Output:

```
Admin user "admin" created.
Default API key (save this — shown once):
  ID:  <uuid>
  Key: <64-char hex key>
```

**Save the key immediately.** The raw key is shown once and is never stored.

### 3. Use the API key

Include it as a Bearer token on every API request:

```bash
curl -H "Authorization: Bearer <your-api-key>" http://localhost:3000/api/snapshots
```

With the SDK:

```ts
import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.WEBFROST_API_KEY,
});

const snapshots = await client.listSnapshots();
```

### 4. Session login (browser / UI)

The React UI authenticates via session cookie. You can also use the login endpoint directly:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-password>"}'

# Use the session cookie for subsequent requests
curl -b cookies.txt http://localhost:3000/api/snapshots
```

### 5. Manage API keys

```bash
# Create an additional named key
webfrost admin key create --name ci-deploy

# With optional expiry (ISO 8601 date)
webfrost admin key create --name ci-deploy --expires 2026-12-31T23:59:59Z

# List active keys (shows ID, name, expiry, last used)
webfrost admin key list

# Revoke a key by ID
webfrost admin key revoke <id>
```

### Dev mode (auth disabled)

For local development, set `AUTH_DISABLED=true` to bypass all auth checks:

```bash
AUTH_DISABLED=true WEBFROST_DIR=./data bun run packages/server/src/index.ts
```

> Never set `AUTH_DISABLED=true` in production.

---

## Backup and Restore

WebFrost state lives in two places inside `WEBFROST_DIR` (default `/data` in Docker):

| Path | Contents |
|------|----------|
| `webfrost.db` | SQLite database — snapshot metadata, extractor results |
| `snapshots/` | Archive files (WARC, PDF, readability JSON) |

### Backup

```bash
# Stop the container first (or use SQLite online-backup via sqlite3 CLI)
docker compose -f docker-compose.prod.yml stop

# Back up to a timestamped tarball
tar -czf "webfrost-backup-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C /var/lib/docker/volumes/webfrost_webfrost_data/_data .

# Restart
docker compose -f docker-compose.prod.yml start
```

> **Hot backup (no downtime):** Use SQLite's `.backup` command to copy `webfrost.db` online:
> ```bash
> sqlite3 /data/webfrost.db ".backup /backups/webfrost-$(date +%Y%m%d).db"
> ```
> Then copy the `snapshots/` directory separately.

### Restore

```bash
# Stop container
docker compose -f docker-compose.prod.yml stop

# Extract backup into the volume
tar -xzf webfrost-backup-20240101-120000.tar.gz \
  -C /var/lib/docker/volumes/webfrost_webfrost_data/_data

# Start container and verify
docker compose -f docker-compose.prod.yml start
curl http://localhost:3000/health
curl http://localhost:3000/api/snapshots
```

**Smoke-test after restore:** confirm the `GET /health` endpoint returns `{"status":"ok"}` and `GET /api/snapshots` returns your historical snapshot list.

### Scheduled backups

Example cron entry (backs up nightly at 2 AM, keeps 7 days):

```cron
0 2 * * * sqlite3 /data/webfrost.db ".backup /backups/webfrost-$(date +\%Y\%m\%d).db" && find /backups -name 'webfrost-*.db' -mtime +7 -delete
```

---

### 2. npm publish (future — not yet active)

**Packages:** `@webfrost/core`, `@webfrost/cli`

**Current state:** All packages are marked `"private": true`. npm publish is disabled in `release.yml` (`if: false` guard).

**To enable:**
1. Set `"private": false` in the relevant `package.json` files.
2. Create an npm token and add it as the `NPM_TOKEN` repository secret.
3. Remove the `if: false` guard in `.github/workflows/release.yml`.
4. Push a version tag to trigger the release.

---

## Secrets Required

| Secret | Where | Purpose |
|--------|-------|---------|
| `GITHUB_TOKEN` | Auto-injected | GHCR push |
| `NPM_TOKEN` | Repo → Settings → Secrets | npm publish (future) |

---

## Adding a New Deploy Target

1. Create a new job in `.github/workflows/release.yml`.
2. Gate it on `ci-check`.
3. Document it here.
4. Open a WEB ticket for DevOps review before enabling in production.
