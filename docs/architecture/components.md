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
    Component(pipeline, "Pipeline", "pipeline.ts", "Orchestrates a full snapshot: launches browser, runs all extractors in parallel, writes results to DB and disk.")
    Component(extractors, "Extractors", "extractors/", "Individual extractor modules: warc, readability, pdf, screenshot, dom-snapshot, singlefile, html, media, media-metadata.")
    Component(db, "Database", "db.ts", "SQLite access layer. Snapshots, extractor results, tags, schedules, API keys, import history, FTS index.")
    Component(fetchCache, "Fetch Cache", "fetch-cache.ts", "In-memory HTTP cache shared across extractors within one snapshot. Ensures one network request per resource.")
    Component(importModule, "Import", "import.ts", "Parses and enqueues URLs from plain text, OPML, Netscape HTML, and RSS feeds.")
    Component(scheduler, "Scheduler", "cron.ts / schedules.ts", "Cron expression evaluation and schedule execution logic.")
    Component(auth, "Auth", "auth.ts", "Password hashing, API key generation and verification, session management.")
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
  Rel(importModule, pipeline, "Enqueues URLs")
  Rel(scheduler, pipeline, "Triggers due schedules")
  Rel(db, db_file, "SQLite queries")
```

## Component notes

**Pipeline** is the central orchestrator. It creates the SQLite snapshot record, starts Chromium, initializes the shared HTTP cache, fans out to all extractors, collects results, writes files, and updates the snapshot status on completion or failure.

**Fetch Cache** is an in-memory cache scoped to a single snapshot run. Text extractors (WARC, Readability, HTML) share it so the page is fetched once over HTTP, not once per extractor.

**Extractors** are small, independent modules — one per output format. They receive the page handle (for browser extractors) or the fetch cache (for HTTP extractors) and return a `Buffer` or JSON object.

**Scheduler** evaluates cron expressions against the current time and dispatches due schedules to the pipeline. It runs as a polling loop inside the server.

**Database** is a thin wrapper around SQLite with typed accessors for all tables. It does not use an ORM — queries are plain SQL.

See [Pipeline](/architecture/pipeline) for the sequence of events during a snapshot run.
