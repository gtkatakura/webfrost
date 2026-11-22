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
3. When that PR is merged, push the generated version tag to trigger the Docker publish:
   ```bash
   git tag v$(cat packages/core/package.json | jq -r .version)
   git push origin HEAD --tags
   ```

See [Releasing](../apps/docs/content/docs/contributing/releasing.mdx) for the full release checklist.
