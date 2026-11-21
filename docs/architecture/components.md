---
title: Components
description: Internal components of @webfrost/core (C4 Component diagram).
---

# Components

The C4 Component diagram shows the major modules inside `@webfrost/core`.

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

## Component notes

**Pipeline** is the central orchestrator. It fetches the page (SSRF-guarded), starts Chromium (every browser request is SSRF-guarded too), initializes the shared HTTP cache, fans out to all extractors, collects results, writes files, and sets the snapshot status: `done` when at least one extractor produced output, `failed` otherwise.

**Fetch Cache** is an in-memory cache scoped to a single snapshot run. Text extractors (WARC, Readability, HTML) share it so the page is fetched once over HTTP, not once per extractor.

**Extractors** are small, independent modules — one per output format. They receive the page handle (for browser extractors) or the fetch cache (for HTTP extractors) and return a `Buffer` or JSON object.

**Job Runner** queues pipelines started by the server (API submissions, imports, schedules) and runs at most `WEBFROST_CONCURRENCY` of them at once. On startup it re-queues snapshots left `pending` by a previous run.

**Scheduler** polls every 30 s, evaluates cron expressions (in the process time zone), atomically claims due schedules and hands them to the job runner. It runs inside the server and in `webfrost schedule worker`.

**Database** is a thin wrapper around SQLite with typed accessors for all tables. It does not use an ORM — queries are plain SQL.

See [Pipeline](/architecture/pipeline) for the sequence of events during a snapshot run.
