# Deploy Path — WebFrost

This document describes the deploy targets and pipeline for WebFrost. It is maintained by DevOps and must be updated when any step changes.

---

## CI Pipeline (every PR and `main` push)

File: `.github/workflows/ci.yml`

| Step | Command | Notes |
|------|---------|-------|
| Install deps | `bun install --frozen-lockfile` | Bun dep cache keyed on `bun.lockb` |
| Lint | `bun run lint` | Biome check |
| Typecheck | `bun run typecheck` | `tsc --noEmit` |
| Test | `bun test` | All workspace packages |
| Playwright browsers | `bunx playwright install --with-deps chromium` | Cached per `bun.lockb` hash |
| Bench (PR) | `bun run bench` | 5-min timeout, `continue-on-error: true` |
| Bench (main) | `bun run bench` | Full suite, results uploaded as artifact |

**Bench artifacts** are uploaded on `main` pushes and retained for 90 days under `bench-results-<sha>`. Baseline numbers should be documented in `bench/BASELINE.md` (created by the first full bench run on main).

---

## Deploy Targets

### 1. Docker → GitHub Container Registry (GHCR)

**Target:** `ghcr.io/<org>/webfrost/server`

**Trigger:** Push a semver tag (e.g. `v0.1.0`) or run `release.yml` manually with target `docker-ghcr`.

**Steps (automated via `.github/workflows/release.yml`):**

1. CI gate passes (lint, typecheck, test).
2. GHCR login via `GITHUB_TOKEN` (no extra secret needed).
3. Docker image built from `packages/server/Dockerfile`.
4. Tagged as `v<semver>`, `<major>.<minor>`, and `sha-<sha>`.
5. Layer cache via GitHub Actions cache (`cache-from/to: type=gha`).

**To release a new server image:**

```bash
git tag v0.1.0
git push origin v0.1.0
```

**Required files (to be created by Engineer):**
- `packages/server/Dockerfile` — multi-stage Bun image

**Suggested Dockerfile pattern:**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build --filter @webfrost/server

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "dist/index.js"]
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
