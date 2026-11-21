---
title: Containers
description: The major packages in the WebFrost monorepo and how they communicate (C4 Container diagram).
---

# Containers

The C4 Container diagram shows the major deployable units in WebFrost and how they communicate.

```mermaid
C4Container
  title WebFrost — Containers

  Person(user, "User")

  Container_Boundary(mono, "WebFrost Monorepo") {
    Container(cli, "@webfrost/cli", "Bun / TypeScript", "Command-line interface. Direct archive, import, schedule, tag, and admin commands.")
    Container(server, "@webfrost/server", "Elysia / Bun", "HTTP server. REST API + serves the React UI. Embeds the scheduler and background job runner.")
    Container(ui, "@webfrost/ui", "React / Vite", "Single-page application. Browse snapshots, manage tags and schedules, import URLs.")
    Container(sdk, "@webfrost/sdk", "TypeScript", "Typed HTTP client for the server REST API. Published as an npm package.")
    Container(core, "@webfrost/core", "TypeScript / Bun", "Shared library. Database layer, archive pipeline, extractors, scheduler, import, RSS.")
  }

  ContainerDb(db, "SQLite (archive.db)", "SQLite / FTS5", "Snapshots, extractor results, tags, schedules, users, sessions, API keys, import history.")
  ContainerDb(files, "Archive Files", "Filesystem", "WARC, PDF, PNG, JSON, HTML files per snapshot.")

  System_Ext(browser, "Chromium")
  System_Ext(ytdlp, "yt-dlp")
  System_Ext(web, "Public Web")

  Rel(user, cli, "Runs commands", "Shell")
  Rel(user, ui, "Uses browser", "HTTPS")
  Rel(ui, server, "API calls", "REST/JSON")
  Rel(sdk, server, "API calls", "REST/JSON")
  Rel(cli, core, "Uses library")
  Rel(server, core, "Uses library")
  Rel(core, db, "Reads/writes", "SQLite")
  Rel(core, files, "Reads/writes archive files")
  Rel(core, browser, "Launches for PDF/screenshot/DOM/SingleFile", "Playwright")
  Rel(core, ytdlp, "Spawns for media", "Subprocess")
  Rel(core, web, "Fetches URLs", "HTTP")
```

## Package responsibilities

| Package | Role | Entry point |
|---|---|---|
| `@webfrost/core` | Shared library — pipeline, extractors, DB, scheduler, import | Library, not executable |
| `@webfrost/cli` | CLI binary (`webfrost`) | `packages/cli/src/index.ts` |
| `@webfrost/server` | Elysia HTTP server + embeds the scheduler and job runner | `packages/server/src/index.ts` |
| `@webfrost/ui` | React SPA, built to `packages/ui/dist/` (served by the server) | `packages/ui/src/main.tsx` |
| `@webfrost/sdk` | Typed REST API client, published to npm | `packages/sdk/src/index.ts` |

## Key relationships

- **CLI and server both use `core`** — the pipeline logic lives once in `@webfrost/core`, not in either consumer.
- **Server embeds the scheduler** — no separate worker process needed. The scheduler (polls every 30 s) and the job runner that bounds archive concurrency (`WEBFROST_CONCURRENCY`) run inside the server process. `webfrost schedule worker` uses the same scheduler and can run next to the server on one archive, because due schedules are claimed atomically. `WEBFROST_SCHEDULER=false` disables the server's scheduler.
- **UI talks only to the server** — the React SPA makes REST calls to `@webfrost/server`. It has no direct dependency on `core`.
- **SDK is a thin REST wrapper** — typed TypeScript methods around the same REST API that the UI uses.
