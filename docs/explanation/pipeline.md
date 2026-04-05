# Explanation: Pipeline

How WebFrost archives a URL — from request to stored snapshot.

Diagrams use [Mermaid](https://mermaid.js.org/). Standalone `.mmd` files are in [`docs/diagrams/sequences/`](../diagrams/sequences/).

---

## Archive pipeline

A single URL archive run from submission to completion.

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

  CLI-->>User: ✓ snapshot <id> — warc, pdf, screenshot, ...
```

---

## Download flow

How the server resolves and serves an archive file download request.

```mermaid
sequenceDiagram
  actor Client
  participant Server as Server (Elysia)
  participant Auth as Auth middleware
  participant DB as SQLite
  participant Storage as Filesystem (future: S3)

  Client->>Server: GET /api/snapshots/:id/archives/:extractor/download
  Server->>Auth: validate Bearer token or session cookie
  Auth-->>Server: ok / 401

  Server->>DB: SELECT extractor_result WHERE snapshotId=:id AND extractor=:extractor
  DB-->>Server: { filePath, mimeType }

  alt file on local filesystem
    Server->>Storage: read file
    Storage-->>Server: file buffer
    Server-->>Client: 200 file download (Content-Disposition: attachment)
  else file on S3 (future)
    Server->>Storage: generate presigned URL
    Storage-->>Server: presigned URL
    Server-->>Client: 302 redirect to presigned URL
  end
```

---

## Import flow

How a bulk import (plain text, OPML, RSS, Netscape HTML) is processed.

```mermaid
sequenceDiagram
  actor User
  participant CLI as CLI / API
  participant Import as Import module (core)
  participant Parser as Format parser
  participant DB as SQLite
  participant Queue as Archive queue
  participant Pipeline as Pipeline (core)

  User->>CLI: webfrost import urls.txt
  CLI->>Import: importFile(path, format)

  Import->>Parser: parse file (text/opml/rss/netscape)
  Parser-->>Import: URL list

  loop for each URL
    Import->>DB: check import_history (skip if already imported)
    alt not yet imported
      Import->>DB: INSERT import_history
      Import->>Queue: enqueue URL
    end
  end

  Import-->>CLI: { queued, skipped, total }
  CLI-->>User: Queued N URLs

  loop for each queued URL (concurrently, up to WEBFROST_CONCURRENCY)
    Queue->>Pipeline: run(url)
    Pipeline-->>DB: snapshot stored
  end
```

---

## Schedule flow

How a scheduled archive is triggered and executed.

```mermaid
sequenceDiagram
  participant Worker as Schedule worker
  participant DB as SQLite
  participant Cron as Cron evaluator
  participant Pipeline as Pipeline (core)

  loop every poll interval
    Worker->>DB: SELECT schedules WHERE paused=false
    DB-->>Worker: schedule list

    loop for each schedule
      Worker->>Cron: isDue(schedule.cron, schedule.lastRunAt)
      alt due
        Worker->>DB: UPDATE schedule (lastRunAt=now)
        Worker->>Pipeline: run(schedule.url)
        alt success
          Worker->>DB: UPDATE schedule (lastStatus=success, consecutiveFailures=0)
        else failure
          Worker->>DB: UPDATE schedule (lastStatus=error, consecutiveFailures++)
        end
      end
    end
  end
```

---

## Key design choices

- **Parallel extractors, single navigation.** All extractors for one URL share one Playwright page instance and one HTTP fetch cache. This means one DNS lookup, one TLS handshake, one page load — regardless of how many extractors run.

- **Sync import history.** The import module tracks every imported URL in `import_history`. Re-importing the same file or feed skips already-imported URLs, making re-runs idempotent.

- **No external queue.** The archive queue is in-memory, bounded by `WEBFROST_CONCURRENCY`. For higher throughput a persistent queue would be needed, but for self-hosted use cases the simplicity is worth it.

For the component-level view, see [Explanation: Architecture](./architecture.md).
