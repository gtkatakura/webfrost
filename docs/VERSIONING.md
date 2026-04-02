# Versioning Strategy

WebFrost uses [Semantic Versioning 2.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

Version management and changelog generation are handled by [changesets](https://github.com/changesets/changesets).

**Current policy:** all packages stay on `0.x` until the board decides to release `1.x`.

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

Examples: `v0.2.0-alpha.1`, `v0.2.0-beta.2`, `v0.2.0-rc.1`, `v0.2.0`

---

## Changesets workflow

### Adding a changeset (per-PR)

```bash
bun changeset
# Select bump type and write a short description.
# Commit the generated .changeset/<random-name>.md with your PR.
```

### Version bump (release preparation)

The `changesets/action` bot creates a **"chore: version packages"** PR on every push to `main` that contains pending changesets. Merge it to apply bumps and update `CHANGELOG.md`.

### Tagging and releasing

After the Version Packages PR is merged:

```bash
NEW_VERSION=$(node -p "require('./packages/core/package.json').version")
git tag "v$NEW_VERSION"
git push origin HEAD "v$NEW_VERSION"
```

The CI pipeline gates every release: lint → typecheck → test must pass before Docker publish runs.

---

## Package versioning policy

All packages in the monorepo (`@webfrost/core`, `@webfrost/cli`, `@webfrost/server`, `@webfrost/sdk`, `@webfrost/ui`) move together — they share a single version number, enforced via a changesets `fixed` group in `.changeset/config.json`. This keeps the release matrix simple and avoids cross-package compatibility questions.

---

## CHANGELOG format

Changesets auto-generates `CHANGELOG.md` entries. The format follows:

```markdown
## <version>

### Major Changes
- Description of breaking change

### Minor Changes
- Description of new feature

### Patch Changes
- Description of bug fix
```

For manual edits or entries not covered by changesets, use the same structure and keep bullets concise — one line each.
