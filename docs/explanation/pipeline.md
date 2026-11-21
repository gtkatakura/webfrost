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

---

## Download flow

How the server resolves and serves an archive file download request.

```mermaid
sequenceDiagram
  actor Client
  participant Server as Server (Elysia)
  participant Auth as Auth middleware
  participant DB as SQLite
  participant Storage as Storage backend

  Client->>Server: GET /api/snapshots/:id/archives/:extractor/download
  Server->>Auth: validate Bearer token or session cookie
  Auth-->>Server: ok / 401

  Server->>DB: SELECT archive_results WHERE snapshot_id=:id AND extractor=:extractor AND error IS NULL
  DB-->>Server: { content (storage ref) }

  alt file on local filesystem
    Server->>Storage: read file
    Storage-->>Server: file buffer
    Server-->>Client: 200 file download (Content-Disposition: attachment)
  else file on S3
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

---

## Schedule flow

How a scheduled archive is triggered and executed.

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

---

## Key design choices

- **Parallel extractors, single navigation.** All extractors for one URL share one Playwright page instance and one HTTP fetch cache. This means one DNS lookup, one TLS handshake, one page load — regardless of how many extractors run.

- **One job runner, bounded concurrency.** Every pipeline the server starts (`POST /api/snapshots`, imports, schedules) goes through a single `JobRunner` (`packages/core/src/jobs.ts`), limited to `WEBFROST_CONCURRENCY` pipelines at once (default 3). Each job opens its own database connection. `job_queue.status` goes `pending` → `running` → `done` or `failed`. At startup the server (and `webfrost schedule worker`) re-queues snapshots a previous run left `pending`, so a restart or crash does not strand them.

- **Snapshot status is `pending`, `done` or `failed`.** A snapshot is `done` when at least one extractor produced output, and `failed` when the page could not be fetched or no extractor succeeded. Browser extractors (pdf, screenshot, dom-snapshot, singlefile) that cannot run — Chromium missing, navigation failed, SSRF policy violation — are recorded in `archive_results` with an `error` and show up as `status: "failed"` in the API's `extractorMeta`. Media extraction is skipped silently when `yt-dlp` is not installed or the URL is not a media page.

- **Timeouts and politeness.** The page fetch, each extractor and each `yt-dlp` run have their own timeouts (`WEBFROST_FETCH_TIMEOUT_MS`, `WEBFROST_EXTRACTOR_TIMEOUT_MS`, `WEBFROST_MEDIA_TIMEOUT_MS`), browser navigation is capped at 30 s, and two archives of the same hostname start at least `WEBFROST_DOMAIN_DELAY_MS` apart (default 1 s). See [Environment variables](/reference/environment-variables).

- **SSRF guard.** The page fetch and every request the headless browser makes are checked against the SSRF policy. Details are in [Security](/SECURITY).

- **Deduplication by URL.** RSS imports skip URLs that already have a snapshot and report them as `skipped`; the `imports` table only records a history of each import operation.

- **Embedded scheduler.** The server polls for due schedules every 30 s and claims each one atomically, so it can run next to `webfrost schedule worker` on the same archive without double-running.

- **No external queue.** The runner is in-process and bounded by `WEBFROST_CONCURRENCY`; the `pending` rows in SQLite are what survive a restart. For higher throughput a persistent distributed queue would be needed, but for self-hosted use cases the simplicity is worth it.

For the component-level view, see [Explanation: Architecture](./architecture.md).
