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
mise install        # Bun at the pinned version
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
mise run test:e2e   # the web UI in a real browser (Playwright; needs Chromium and yt-dlp)
```

Lefthook runs lint and typecheck on every commit. Fix what it reports — do not skip the hooks.

Tests that drive a real browser (`packages/core/src/browser-guard.test.ts`) are skipped when no
Chromium is available, so run them at least once with one installed if you touch the pipeline.

## What a good change looks like

- **A test that fails without your change.** Bugs here have mostly been of the "returns 202 but
  nothing happens afterwards" kind, so assert on the final state (snapshot status, stored files),
  not just on the response.
- **Docs in the same pull request.** Everything that describes the change moves with it:
  - the reference pages in `apps/docs/content/docs` (CLI, REST API, SDK, configuration, extractors,
    web UI), and any guide that still tells the old story. A new API route or environment variable
    without its row fails `packages/server/src/docs-coverage.test.ts`;
  - for a visible UI change, the screenshots: run `mise run docs:screens -- <base-url> <snapshot-id>`
    against a WebFrost with a few real pages archived (it writes the README's screenshot too);
  - `README.md` when the quickstart, the install options or the big picture change;
  - `ROADMAP.md`: a shipped item moves to "Already there";
  - the agent skills in `skills/` when the usage they teach changes.
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
