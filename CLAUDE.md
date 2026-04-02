# WebFrost

## Git Workflow

**After completing any task that modifies code, you MUST commit and push to remote.**

1. Stage only the files you changed (no `git add -A` or `git add .`).
2. Write a clear, concise commit message describing the change.
4. Push to the remote: `git push origin HEAD`.
5. If the push fails due to upstream changes, pull with rebase (`git pull --rebase origin main`) and push again.
6. Never force-push to `main`.

## Pre-commit Hooks

Lefthook runs lint (biome) and typecheck on pre-commit. Fix any failures before committing — do not skip hooks with `--no-verify`.

## Monorepo

- Package manager: **bun**
- Workspaces: `packages/*`
- Lint: `bun run lint`
- Format: `bun run format`
- Test: `bun run test`
- Typecheck: `bun run typecheck`
