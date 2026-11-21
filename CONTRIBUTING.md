# Contributing to WebFrost

Thanks for helping out. This page is the short version; the full guide lives in
[contributing/development.mdx](apps/docs/content/docs/contributing/development.mdx) and the code layout in
[contributing/project-structure.mdx](apps/docs/content/docs/contributing/project-structure.mdx).

## Setup

Requirements: [mise](https://mise.jdx.dev), which installs the pinned Bun (`mise.toml`); a Chromium for the
browser extractors, and optionally `yt-dlp` + `ffmpeg` for media extraction.

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
mise install        # Bun (and Ruby, for the docs deploy) at the pinned versions
mise run setup      # bun install + Playwright's Chromium
mise run dev        # API on :3000 (auth disabled) + UI dev server on :5173
mise tasks          # every task
```

Already have a Chromium installed? Skip the Playwright download and point WebFrost at it:

```bash
export WEBFROST_CHROMIUM_PATH=/usr/bin/chromium
```

## Before you open a pull request

```bash
bun run lint        # Biome
bun run typecheck   # tsc --noEmit
bun run test        # unit + integration tests for every package
cd packages/server && bun run test:e2e   # HTTP API end to end
```

Lefthook runs lint and typecheck on every commit. Fix what it reports — do not skip the hooks.

Tests that drive a real browser (`packages/core/src/browser-guard.test.ts`) are skipped when no
Chromium is available, so run them at least once with one installed if you touch the pipeline.

## What a good change looks like

- **A test that fails without your change.** Bugs here have mostly been of the "returns 202 but
  nothing happens afterwards" kind, so assert on the final state (snapshot status, stored files),
  not just on the response.
- **Docs in the same pull request.** `README.md` and `ROADMAP.md` must match what the code does:
  new CLI commands, API routes, environment variables and extractors all need a mention, and a
  shipped roadmap item flips to ✅.
- **A changeset** for anything users will notice: `bun changeset`.
- **Small and focused.** One concern per pull request; refactors separate from behaviour changes.

## Where things go

| Package | What belongs there |
|---|---|
| `packages/core` | Database, pipeline, extractors, scheduler, storage backends, auth primitives |
| `packages/cli` | The `webfrost` command — a thin layer over core |
| `packages/server` | HTTP API (Elysia) and static hosting of the UI |
| `packages/sdk` | Typed client for the HTTP API; no dependency on core |
| `packages/ui` | React single-page app; talks to the server only through the SDK |

## Conduct

Be respectful and keep discussion about the work. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security issues

Please do not open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
