---
title: Pipeline
description: How WebFrost archives a URL — sequence diagrams for archive, download, import, and schedule flows.
---

# Pipeline

How WebFrost archives a URL — from submission to stored snapshot.

## Archive pipeline

A single URL archive run from start to completion.

```mermaid
sequenceDiagram
  actor User
  participant CLI as CLI / Server / SDK
  participant Runner as JobRunner (core)
  participant Pipeline as Pipeline (core)
  participant Cache as Fetch Cache
  participant Browser as Chromium (Playwright)
  participant Extractors as Extractors (parallel)
  participant DB as SQLite
  participant FS as Storage backend

  User->>CLI: webfrost add <url> or POST /api/snapshots
  CLI->>DB: INSERT snapshot (status=pending) and job_queue row
  CLI->>Runner: enqueue (server and import: up to WEBFROST_CONCURRENCY at once, webfrost add runs inline)
  Runner->>Pipeline: run(url, snapshotId) on its own DB connection

  Pipeline->>Cache: fetch page (SSRF-guarded)
  Pipeline->>Browser: launch headless Chromium (every browser request SSRF-guarded)
  Browser-->>Pipeline: page handle

  Pipeline->>Extractors: run all in parallel
  note over Extractors: warc, readability, html<br/>use Fetch Cache (no browser)<br/><br/>pdf, screenshot, dom-snapshot,<br/>singlefile use Browser page<br/><br/>media, media-metadata<br/>spawn yt-dlp subprocess

  Extractors-->>Pipeline: results (buffers / JSON) or errors

  Pipeline->>FS: write archive files
  Pipeline->>DB: INSERT archive_results (output or error per extractor)
  Pipeline->>DB: UPDATE snapshot (status=done if any extractor succeeded, else failed)
  Pipeline->>Browser: close
```

## Download flow

How the server resolves and serves an archive file.

```mermaid
sequenceDiagram
  actor Client
  participant Server as @webfrost/server
  participant Auth as Auth middleware
  participant DB as SQLite
  participant Storage as Storage backend

  Client->>Server: GET /api/snapshots/:id/archives/:extractor/download
  Server->>Auth: verify Bearer token or session cookie
  Auth-->>Server: authenticated

  Server->>DB: lookup archive_results (snapshot_id, extractor)
  DB-->>Server: { content (storage ref) }

  alt filesystem backend
    Server->>Storage: read file from WEBFROST_DIR/filePath
    Storage-->>Server: file buffer
    Server-->>Client: 200 with file contents
  else S3 backend
    Server->>Storage: generate presigned URL
    Storage-->>Server: presigned URL (short TTL)
    Server-->>Client: 302 redirect to presigned URL
  end
```

## Import flow

Bulk URL import from a file or feed.

```mermaid
sequenceDiagram
  actor User
  participant CLI as CLI / API
  participant Import as Import module (core)
  participant Parser as Format parser
  participant DB as SQLite
  participant Runner as JobRunner (core)
  participant Pipeline as Pipeline (core)

  User->>CLI: webfrost import urls.txt
  CLI->>Import: parse(input, format)

  Import->>Parser: parse file (text/opml/rss/netscape)
  Parser-->>Import: URL list

  loop for each URL
    Import->>DB: skip if the URL already has a snapshot (RSS imports)
    Import->>DB: INSERT snapshot (status=pending)
    Import->>Runner: enqueue
  end

  Import->>DB: INSERT imports row
  Import-->>CLI: { queued, skipped, total }
  CLI-->>User: Queued N URLs

  loop for each queued URL (concurrently, up to WEBFROST_CONCURRENCY)
    Runner->>Pipeline: run(url)
    Pipeline-->>DB: snapshot stored (done or failed)
  end
```

## Schedule flow

How due schedules are detected and dispatched.

```mermaid
sequenceDiagram
  participant Scheduler as Scheduler (embedded in server or CLI worker)
  participant DB as SQLite
  participant Runner as JobRunner (core)
  participant Pipeline as Pipeline (core)

  loop every 30 seconds
    Scheduler->>DB: SELECT schedules WHERE next_run_at <= now AND paused=0
    DB-->>Scheduler: due schedules

    loop for each due schedule
      Scheduler->>DB: claim (UPDATE next_run_at WHERE next_run_at unchanged)
      alt claimed by this process
        Scheduler->>Runner: enqueue snapshot (feed schedules enqueue each new item)
        Runner->>Pipeline: run(url)
        Scheduler->>DB: UPDATE schedule (lastStatus, consecutiveFailures)
      else already claimed elsewhere
        note over Scheduler: skip - another process won the claim
      end
    end
  end
```
