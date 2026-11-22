# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

## Adding a changeset

After making changes that should be released, run:

```bash
bun changeset
```

Follow the prompts to select the bump type and describe the change. A new markdown file will be created in this directory. Commit it with your PR.

## How releases work

1. Open a PR with your changes and a changeset file.
2. On merge to `main`, the `changesets/action` bot creates or updates a **"chore: version packages"** PR that bumps versions and updates `CHANGELOG.md`.
3. When that PR is merged and CI passes on it, the release workflow tags `v<version>` and publishes the release (Docker image, binaries, GitHub release, Homebrew formula). No manual tag is needed; push a `v*.*.*` tag by hand only for hotfixes and pre-releases.

See [Releasing](../apps/docs/content/docs/contributing/releasing.mdx) for the full release checklist.
