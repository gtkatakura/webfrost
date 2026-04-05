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
  participant Pipeline as Pipeline (core)
  participant Cache as Fetch Cache
  participant Browser as Chromium (Playwright)
  participant Extractors as Extractors (parallel)
  participant DB as SQLite
  participant FS as Filesystem

  User->>CLI: webfrost add <url>
  CLI->>DB: INSERT snapshot (status=pending)
  CLI->>Pipeline: run(url, snapshotId)

  Pipeline->>Cache: init shared HTTP cache
  Pipeline->>Browser: launch headless Chromium
  Browser-->>Pipeline: page handle

  Pipeline->>Extractors: run all in parallel
  note over Extractors: warc, readability, html<br/>use Fetch Cache (no browser)<br/><br/>pdf, screenshot, dom-snapshot,<br/>singlefile use Browser page<br/><br/>media, media-metadata<br/>spawn yt-dlp subprocess

  Extractors-->>Pipeline: results (buffers / JSON)

  Pipeline->>FS: write archive files
  Pipeline->>DB: UPDATE extractor_results
  Pipeline->>DB: UPDATE snapshot (status=complete)
  Pipeline->>Browser: close page
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

  Server->>DB: lookup extractor_result (snapshotId, extractor)
  DB-->>Server: { filePath, mimeType }

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
  participant Import as Import module
  participant RSS as RSS parser
  participant DB as SQLite
  participant Pipeline as Pipeline

  User->>CLI: webfrost import <file-or-url>
  CLI->>Import: parse(input, format)

  alt RSS / Atom feed
    Import->>RSS: fetch and parse feed
    RSS-->>Import: item URLs
  else OPML
    Import->>RSS: fetch each feed in OPML
    RSS-->>Import: all item URLs
  else plain text / Netscape HTML
    Import->>Import: parse URLs from file
  end

  Import->>DB: filter out URLs in import_history
  Import-->>CLI: { queued, skipped, total }

  loop for each new URL
    Import->>DB: INSERT import_history entry
    Import->>Pipeline: run(url)
  end
```

## Schedule flow

How due schedules are detected and dispatched.

```mermaid
sequenceDiagram
  participant Worker as Schedule worker
  participant DB as SQLite
  participant Import as Import module
  participant Pipeline as Pipeline

  loop every minute
    Worker->>DB: SELECT schedules WHERE nextRunAt <= now AND paused = 0
    DB-->>Worker: due schedules

    loop for each due schedule
      alt URL schedule
        Worker->>Pipeline: run(url)
      else RSS schedule
        Worker->>Import: importUrls(feedUrl, "rss")
        Import->>Pipeline: run(each item URL)
      end
      Worker->>DB: UPDATE schedule (lastRunAt, lastStatus, consecutiveFailures)
    end
  end
```
