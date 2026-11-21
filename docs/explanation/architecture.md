# Explanation: Architecture

WebFrost's architecture is described here using the [C4 model](https://c4model.com/) — three levels of zoom: System Context, Container, and Component.

Diagrams use [Mermaid](https://mermaid.js.org/) for portability. Standalone `.mmd` files are in [`docs/diagrams/`](../diagrams/).

---

## Level 1 — System Context

Who uses WebFrost and what external systems does it interact with?

```mermaid
C4Context
  title WebFrost — System Context

  Person(user, "User", "Archives web pages via CLI, web UI, or API")
  Person(devOps, "DevOps / Admin", "Deploys and operates the server")

  System(webfrost, "WebFrost", "Self-hosted web archiving toolkit. Archives URLs to WARC, PDF, screenshots, and structured text.")

  System_Ext(web, "Public Web", "Websites, RSS feeds, media URLs (YouTube, Vimeo, etc.)")
  System_Ext(storage, "Local Filesystem / S3", "Durable archive file storage")
  System_Ext(browser, "Chromium", "Headless browser for rendering pages and running extractors")
  System_Ext(ytdlp, "yt-dlp", "Media downloader for video/audio URLs")

  Rel(user, webfrost, "Archives URLs, searches snapshots, manages tags and schedules")
  Rel(devOps, webfrost, "Deploys, configures, creates admin account")
  Rel(webfrost, web, "Fetches URLs for archiving")
  Rel(webfrost, browser, "Launches headless browser sessions")
  Rel(webfrost, ytdlp, "Spawns for media extraction")
  Rel(webfrost, storage, "Reads/writes archive files and SQLite database")
```

---

## Level 2 — Containers

What are the major deployable units and how do they communicate?

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

---

## Level 3 — Component: `@webfrost/core`

What are the major internal components of the core library?

```mermaid
C4Component
  title @webfrost/core — Components

  Container_Boundary(core, "@webfrost/core") {
    Component(pipeline, "Pipeline", "pipeline.ts", "Orchestrates a full snapshot: fetches the page, launches browser, runs all extractors in parallel, writes results to DB and disk.")
    Component(jobs, "Job Runner", "jobs.ts", "Runs pipelines in the background, bounded by WEBFROST_CONCURRENCY. Each job opens its own DB connection. Re-queues snapshots left pending by a previous run.")
    Component(extractors, "Extractors", "extractors/", "Individual extractor modules: warc, readability, pdf, screenshot, dom-snapshot, singlefile, html, media, media-metadata.")
    Component(db, "Database", "db.ts", "SQLite access layer. Snapshots, extractor results, tags, schedules, sessions, API keys, import history, FTS index.")
    Component(fetchCache, "Fetch Cache", "fetch-cache.ts", "In-memory HTTP cache shared across extractors within one snapshot. Ensures one network request per resource.")
    Component(importModule, "Import", "import.ts", "Parses and enqueues URLs from plain text, OPML, Netscape HTML, and RSS feeds.")
    Component(scheduler, "Scheduler", "scheduler.ts / cron.ts / schedules.ts", "Polls for due schedules every 30 s, claims each atomically and queues it. Cron is evaluated in the process time zone.")
    Component(auth, "Auth", "auth.ts", "Password hashing, API key generation and verification, server-side sessions.")
    Component(rss, "RSS", "rss.ts", "Fetches and parses RSS/Atom feeds.")
  }

  ContainerDb(db_file, "SQLite (archive.db)")
  ContainerDb(files, "Archive Files")
  System_Ext(browser, "Chromium (Playwright)")
  System_Ext(ytdlp, "yt-dlp")

  Rel(pipeline, fetchCache, "Shares cache across extractors")
  Rel(pipeline, extractors, "Runs in parallel")
  Rel(pipeline, db, "Persists snapshot and results")
  Rel(pipeline, files, "Writes archive files")
  Rel(extractors, browser, "pdf, screenshot, dom-snapshot, singlefile")
  Rel(extractors, ytdlp, "media, media-metadata")
  Rel(importModule, rss, "RSS feed import")
  Rel(importModule, jobs, "Enqueues URLs")
  Rel(scheduler, jobs, "Queues due schedules")
  Rel(jobs, pipeline, "Runs pipelines")
  Rel(db, db_file, "SQLite queries")
```

---

## Design decisions

- **One browser navigation per snapshot.** Playwright is launched once per URL. All browser-dependent extractors (PDF, screenshot, DOM snapshot, SingleFile) share that navigation. This avoids re-loading the page multiple times.

- **Shared HTTP cache per snapshot.** `fetch-cache.ts` caches HTTP responses in memory for the duration of the snapshot pipeline. Text-based extractors (WARC, Readability, HTML) that need raw HTTP responses draw from this cache rather than making duplicate requests.

- **SQLite + local files.** The archive is a directory on disk — the SQLite database and the files alongside it. No external database dependency. Back up the directory to back up the archive.

- **Monorepo, separate packages.** `@webfrost/core` is the library. CLI, server, and SDK are thin layers on top. Adding a new interface (e.g., a desktop app) means implementing against `core` without touching the pipeline.

For the pipeline flow in detail, see [Explanation: Pipeline](./pipeline.md).
For storage layout, see [Explanation: Storage model](./storage-model.md).
