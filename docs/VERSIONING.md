# Versioning Strategy

WebFrost uses [Semantic Versioning 2.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

---

## Version bump rules

| Change type | Bump |
|-------------|------|
| Breaking API or CLI change, incompatible database migration | **MAJOR** |
| New feature, new CLI command, new server route — backwards-compatible | **MINOR** |
| Bug fix, docs update, dependency update, performance tweak | **PATCH** |

**When in doubt, use PATCH.** Prefer MINOR over MAJOR — WebFrost is self-hosted, so users control their own upgrades.

---

## Pre-release identifiers

Append a pre-release suffix to the version tag before cutting a release candidate:

| Suffix | Meaning |
|--------|---------|
| `-alpha.N` | Incomplete feature — not ready for broad testing |
| `-beta.N` | Feature-complete but may still have known issues |
| `-rc.N` | Release candidate — expected to ship unless a blocking bug is found |

Examples: `v1.0.0-alpha.1`, `v1.0.0-beta.2`, `v1.0.0-rc.1`, `v1.0.0`

---

## Tagging and releasing

All version tags live on `main`. The tag triggers the release pipeline (`release.yml`):

```bash
# Bump package versions (all packages move together)
bun version patch   # or minor / major

# Tag and push — triggers Docker image build + GHCR push
git tag v1.0.0
git push origin v1.0.0
```

The CI pipeline gates every release: lint → typecheck → test must pass before Docker publish runs.

---

## Package versioning policy

All packages in the monorepo (`@webfrost/core`, `@webfrost/cli`, `@webfrost/server`, `@webfrost/sdk`, `@webfrost/ui`) move together — they share a single version number. This keeps the release matrix simple and avoids cross-package compatibility questions.

---

## CHANGELOG format

Maintain `CHANGELOG.md` at the repo root. Each entry follows this structure:

```markdown
## [version] — YYYY-MM-DD

### Added
- Short description of new features

### Changed
- Backwards-compatible behaviour changes, dependency updates

### Fixed
- Bug fixes

### Breaking
- Anything that requires user action on upgrade (migration steps, removed flags)
```

Only include sections that have entries. Keep bullets concise — one line each.
