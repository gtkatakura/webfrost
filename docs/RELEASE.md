# Release Guide — WebFrost

This document covers cutting a versioned release of WebFrost. See `docs/DEPLOY.md` for infrastructure details.

---

## Versioning

WebFrost follows **[Semantic Versioning](https://semver.org/)** (`MAJOR.MINOR.PATCH`):

| Increment | When |
|-----------|------|
| `PATCH` | Bug fixes, docs, non-breaking infra changes |
| `MINOR` | New backwards-compatible features |
| `MAJOR` | Breaking API or storage format changes |

---

## Release Checklist

Work through this list top-to-bottom. Do not skip steps.

### 1. Prepare the release branch

- [ ] All intended PRs are merged to `main`.
- [ ] CI is green on `main` (lint, typecheck, test, Playwright smoke).
- [ ] Bench results on `main` look reasonable (check `bench-results-<sha>` artifact).

### 2. Bump the version

Bump versions in all three package manifests and the root `package.json`:

```bash
# Example: bump to 0.2.0
NEW_VERSION=0.2.0

# Root manifest (version field if present)
# packages/core/package.json
# packages/cli/package.json
# packages/server/package.json
```

Update `version` in each `package.json`. Cross-package workspace deps use `workspace:*` so no version syncing needed there.

### 3. Update the changelog

Add a `## [<version>] — <date>` section to `CHANGELOG.md` (create it if it doesn't exist yet).
Include:
- **Added** — new features
- **Changed** — behaviour changes
- **Fixed** — bug fixes
- **Removed** — removed functionality

Commit with:

```bash
git add packages/*/package.json CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION

```

### 4. Tag the release

```bash
git tag "v$NEW_VERSION"
git push origin main "v$NEW_VERSION"
```

This triggers `.github/workflows/release.yml` which:
1. Runs the CI gate (lint + typecheck + test).
2. Builds and pushes the Docker image to GHCR with tags `v<version>`, `<major>.<minor>`, and `sha-<sha>`.

### 5. Create a GitHub Release

```bash
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes "$(sed -n "/## \[$NEW_VERSION\]/,/## \[/p" CHANGELOG.md | head -n -1)"
```

Or create it manually via the GitHub UI — point it at the tag just pushed.

### 6. Post-release smoke test

Pull the newly published image and verify it starts:

```bash
docker pull ghcr.io/<org>/webfrost/server:v$NEW_VERSION
docker run --rm -p 3001:3000 ghcr.io/<org>/webfrost/server:v$NEW_VERSION &
sleep 5
curl http://localhost:3001/health
# Expected: {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=ghcr.io/<org>/webfrost/server:v$NEW_VERSION)
```

### 7. npm publish (when ready)

npm publish is currently **disabled** (packages are `"private": true`). To enable:

1. Set `"private": false` in `packages/core/package.json` and `packages/cli/package.json`.
2. Add `NPM_TOKEN` to GitHub repository secrets.
3. Remove the `if: false` guard in `.github/workflows/release.yml` → `npm-publish` job.
4. Push a version tag — the npm publish job will fire automatically after the CI gate.

---

## Hotfix Process

For urgent fixes that cannot wait for a full release cycle:

1. Branch from the broken tag: `git checkout -b hotfix/v0.1.1 v0.1.0`.
2. Apply the minimal fix, bump `PATCH` version, update changelog.
3. Push the branch, open a PR, get review, merge to `main`.
4. Cherry-pick onto `main` if needed (usually the PR merge handles this).
5. Tag `v0.1.1` and push — the release workflow fires automatically.

---

## Rollback

If the release is broken:

```bash
# Re-deploy the previous image
docker compose -f docker-compose.prod.yml stop
IMAGE_TAG=v0.1.0 docker compose -f docker-compose.prod.yml up -d
curl http://localhost:3000/health
```

If the SQLite schema changed in the broken release, restore from backup before re-deploying the old image (see `docs/DEPLOY.md` → Backup and Restore).
