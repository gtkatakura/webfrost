---
title: Development setup
description: Set up a local development environment for WebFrost.
---

# Development setup

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Bun](https://bun.sh) | v1.x | Runtime and package manager |
| [mise](https://mise.jdx.dev/) | any | Tool version management (`.tool-versions`) |
| Chromium | any | Browser extractors (PDF, screenshot, etc.). Installed by Playwright, or point `WEBFROST_CHROMIUM_PATH` at an existing binary |
| yt-dlp, ffmpeg | any | Media extraction (optional) |

## Bootstrap

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
make setup
# or manually:
bun install
bunx playwright install --with-deps chromium
```

## Run the dev stack

```bash
make dev
```

This starts the API server on port 3000 and the Vite UI dev server on port 5173 concurrently. Auth is disabled in dev mode.

Or start manually:

```bash
# Terminal 1 — server
WEBFROST_DIR=./data AUTH_DISABLED=true bun run packages/server/src/index.ts

# Terminal 2 — UI dev server
cd packages/ui && bun run dev
```

## Docs

```bash
bun run docs:dev      # VitePress dev server on http://localhost:5174
bun run docs:build    # Production build (output in dist/docs)
```

## Build

```bash
bun run build        # Build all packages
```

## Test

```bash
bun run test         # Run all tests
make test-e2e        # Run end-to-end tests
```

## Code quality

```bash
bun run lint         # Biome linting
bun run format       # Auto-format with Biome
bun run typecheck    # TypeScript type checking (no emit)
```

## Benchmarks

```bash
bun run bench                   # All benchmarks
make bench-vs-archivebox        # Head-to-head comparison
```

## All Makefile targets

Run `make help` to see all available targets:

```bash
make help
```

## Commit hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs on pre-commit:
- **lint** — Biome check on staged `.js`, `.ts`, `.json`, `.css` files
- **typecheck** — `tsc --noEmit`

Hooks are installed automatically on `bun install` via the `prepare` script.

## Monorepo conventions

- Use `bun run --filter '*' <script>` to run a script across all packages.
- New packages go in `packages/<name>/`.
- Shared types and utilities belong in `@webfrost/core`.
- The UI (`@webfrost/ui`) is built into `packages/ui/dist/` and served statically by the server.
