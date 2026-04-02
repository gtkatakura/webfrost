# Release Guide — WebFrost

This document covers cutting a versioned release of WebFrost. See `docs/DEPLOY.md` for infrastructure details.

WebFrost uses [changesets](https://github.com/changesets/changesets) for version management and changelog generation.

---

## Versioning

WebFrost follows **[Semantic Versioning](https://semver.org/)** (`MAJOR.MINOR.PATCH`):

| Increment | When |
|-----------|------|
| `PATCH` | Bug fixes, docs, non-breaking infra changes |
| `MINOR` | New backwards-compatible features |
| `MAJOR` | Breaking API or storage format changes |

All packages (`@webfrost/core`, `@webfrost/cli`, `@webfrost/server`, `@webfrost/sdk`, `@webfrost/ui`) share a single version number via a changesets `fixed` group. The board decides when to move from `0.x` to `1.x`.

---

## Developer workflow — adding a changeset

Every PR that changes user-facing behaviour should include a changeset:

```bash
bun changeset
# Follow the prompts: pick bump type (patch/minor/major), describe the change.
# Commit the generated .changeset/*.md file with your PR.
```

---

## Release checklist

### 1. Ensure CI is green

- All intended PRs merged to `main`.
- CI green on `main` (lint + typecheck + test).

### 2. Merge the Version Packages PR

When changesets accumulate on `main`, the `changesets/action` bot automatically creates (or updates) a **"chore: version packages"** PR. This PR:
- Bumps all package versions according to the collected changesets.
- Regenerates `CHANGELOG.md` entries.

Review and merge it:

```bash
gh pr list --label "changeset-release/main"
```

### 3. Tag the release

After the Version Packages PR is merged, create and push the version tag:

```bash
NEW_VERSION=$(node -p "require('./packages/core/package.json').version")
git tag "v$NEW_VERSION"
git push origin HEAD "v$NEW_VERSION"
```

This triggers `.github/workflows/release.yml` which:
1. Runs the CI gate (lint + typecheck + test).
2. Builds and pushes the Docker image to GHCR with tags `v<version>`, `<major>.<minor>`, `sha-<sha>`, and `latest`.

### 4. Create a GitHub Release

```bash
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION" \
  --notes "$(sed -n "/## $NEW_VERSION/,/## /p" CHANGELOG.md | head -n -1)"
```

Or create it via the GitHub UI — point it at the tag just pushed.

### 5. Post-release smoke test

```bash
docker pull ghcr.io/<org>/webfrost/server:v$NEW_VERSION
docker run --rm -p 3001:3000 ghcr.io/<org>/webfrost/server:v$NEW_VERSION &
sleep 5
curl http://localhost:3001/health
# Expected: {"status":"ok"}
docker stop $(docker ps -q --filter ancestor=ghcr.io/<org>/webfrost/server:v$NEW_VERSION)
```

### 6. npm publish (when ready)

npm publish is currently **disabled** (packages are `"private": true`). To enable:

1. Set `"private": false` in the relevant `packages/*/package.json` files.
2. Add `NPM_TOKEN` to GitHub repository secrets.
3. Remove the `if: false` guard in `.github/workflows/release.yml` → `npm-publish` job.
4. Push a version tag — the npm publish job will fire automatically after the CI gate.

---

## Hotfix process

For urgent fixes that cannot wait for a full release cycle:

1. Branch from the broken tag: `git checkout -b hotfix/v0.1.1 v0.1.0`.
2. Apply the minimal fix and add a changeset: `bun changeset`.
3. Push the branch, open a PR, get review, merge to `main`.
4. Merge the resulting Version Packages PR, then tag and push.

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
