---
title: Project structure
description: Monorepo layout and package responsibilities for WebFrost.
---

# Project structure

WebFrost is a Bun monorepo. All packages live in `packages/`.

## Top-level layout

```
webfrost/
├── packages/
│   ├── core/          # @webfrost/core — library
│   ├── cli/           # @webfrost/cli — CLI binary
│   ├── server/        # @webfrost/server — HTTP server
│   ├── ui/            # @webfrost/ui — React SPA
│   └── sdk/           # @webfrost/sdk — TypeScript client
├── docs/              # Documentation site (this site)
├── bench/             # Benchmark scripts
├── .github/           # CI workflows
├── package.json       # Workspace root scripts
├── bun.lock           # Lockfile
├── biome.json         # Linting + formatting config
├── tsconfig.json      # Root TypeScript config
├── lefthook.yml       # Git hook config
└── Makefile           # Developer workflow targets
```

## Packages

### `@webfrost/core`

The shared library. Nothing in this package is user-facing directly.

```
packages/core/src/
├── pipeline.ts          # Archive orchestrator (one snapshot)
├── jobs.ts              # JobRunner — bounded background pipelines, pending-snapshot recovery
├── scheduler.ts         # Scheduler — polls for due schedules, claims them atomically
├── db.ts                # SQLite access layer, schema migration
├── fetch-cache.ts       # Shared HTTP cache
├── throttle.ts          # Per-host politeness delay
├── ssrf-guard.ts        # SSRF protection for fetches
├── browser-guard.ts     # SSRF protection for headless-browser requests
├── import.ts            # Bulk import logic
├── cron.ts              # Cron expression evaluation
├── schedules.ts         # Schedule storage (CRUD, due lookup)
├── auth.ts              # Admin users, API keys, sessions
├── search.ts            # FTS5 search
├── tags.ts              # Tags (kept in sync with the FTS index)
├── rss.ts               # RSS/Atom feed parser
└── extractors/
    ├── warc.ts
    ├── readability.ts
    ├── pdf.ts
    ├── screenshot.ts
    ├── dom-snapshot.ts
    ├── singlefile.ts
    ├── html.ts
    ├── media.ts
    └── media-metadata.ts
```

### `@webfrost/cli`

Thin command-line wrapper over `@webfrost/core`. Uses a CLI framework (Cliffy or similar) to parse arguments and call core functions.

### `@webfrost/server`

[Elysia](https://elysiajs.com/) HTTP server. Defines all REST API routes and serves the built React UI from `public/`. The scheduler (`startScheduler` from core) and the background job runner run inside the same process; `WEBFROST_SCHEDULER=false` disables the scheduler.

### `@webfrost/ui`

React single-page application. Built with Vite. Output goes to `packages/ui/dist/`, which the server serves statically (the Docker image copies it to `public/`). During development, Vite proxies API requests to the server.

### `@webfrost/sdk`

Typed TypeScript client for the server REST API. Wraps `fetch`. Published to npm for external use.

## Dependency graph

```
@webfrost/cli
    └── @webfrost/core

@webfrost/server
    └── @webfrost/core

@webfrost/ui
    (no internal deps — talks to server via REST)

@webfrost/sdk
    (no internal deps — talks to server via REST)
```

## Adding a new extractor

1. Create `packages/core/src/extractors/<name>.ts` exporting a `run(context)` function.
2. Add it to the extractor list in `packages/core/src/pipeline.ts`.
3. Add the extractor name to the download route in `packages/server/src/routes/snapshots.ts`.
4. Update [Reference: Extractors](/reference/extractors) and [Reference: Supported outputs](/reference/supported-outputs).
