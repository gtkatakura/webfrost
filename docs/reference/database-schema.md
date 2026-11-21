---
title: Database schema
description: SQLite schema reference for WebFrost's archive.db.
---

# Database schema

WebFrost stores all metadata in a SQLite file called `archive.db` in `WEBFROST_DIR`. The schema is created and migrated by `@webfrost/core` (`packages/core/src/db.ts`) when a connection is opened. The schema version is tracked in `PRAGMA user_version`, so the DDL runs once per archive rather than on every connection.

Every connection sets `PRAGMA busy_timeout = 5000` (a competing writer is waited for up to 5 s instead of failing with `SQLITE_BUSY`), `journal_mode = WAL` and `foreign_keys = ON`. The server, background pipelines and the CLI each open their own connection.

Column names are `snake_case`; timestamps are SQLite `datetime('now')` strings (UTC).

## Tables

### snapshots

One row per archived URL.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key (autoincrement). Also the snapshot directory name. |
| `url` | TEXT | The archived URL. |
| `status` | TEXT | `pending`, `done`, or `failed`. `done` means at least one extractor produced output. |
| `created_at` | TEXT | Creation timestamp. |

### archive_results

One row per extractor per snapshot run. A failed extractor has `error` set and no `content`.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `snapshot_id` | INTEGER | Foreign key → `snapshots.id`. |
| `extractor` | TEXT | Extractor name: `warc`, `pdf`, `screenshot`, etc. |
| `content` | TEXT | Inline content (`html`, `readability`) or a storage reference to the archive file. |
| `duration_ms` | INTEGER | How long the extractor ran. Nullable. |
| `error` | TEXT | Failure reason, or null on success. |
| `created_at` | TEXT | Creation timestamp. |

### job_queue

Background job state, one row per snapshot.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `snapshot_id` | INTEGER | Foreign key → `snapshots.id`. |
| `status` | TEXT | `pending` → `running` → `done` or `failed`. |
| `created_at` | TEXT | Creation timestamp. |

At startup the server (and `webfrost schedule worker`) re-queues snapshots still `pending` from a previous run.

### tags

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `name` | TEXT | Tag name (unique). |
| `slug` | TEXT | URL-safe name (unique). |
| `color` | TEXT | Hex color string, e.g. `#4f46e5`. Nullable. |
| `created_at` | TEXT | Creation timestamp. |

### snapshot_tags

Many-to-many join table between snapshots and tags. Rows are deleted with their snapshot or tag.

| Column | Type | Description |
|---|---|---|
| `snapshot_id` | INTEGER | Foreign key → `snapshots.id`. |
| `tag_id` | INTEGER | Foreign key → `tags.id`. |

### schedules

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `url` | TEXT | URL or RSS feed URL to archive. |
| `cron` | TEXT | Cron expression (5 fields), evaluated in the process time zone. |
| `kind` | TEXT | `url` or `rss_feed`. |
| `paused` | INTEGER | `0` (active) or `1` (paused). |
| `last_run_at` | TEXT | Last execution timestamp. Nullable. |
| `next_run_at` | TEXT | When the schedule is next due. A process claims a due schedule by advancing this value atomically. |
| `last_status` | TEXT | `success`, `failed`, or null. |
| `consecutive_failures` | INTEGER | Count of consecutive failures. Resets on success. |
| `created_at` | TEXT | Creation timestamp. |

### admin_users

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `username` | TEXT | Unique. |
| `password_hash` | TEXT | bcrypt hash. |
| `created_at` | TEXT | Creation timestamp. |

### sessions

Server-side login sessions. A session cookie is only valid while its row exists, so logout and password changes revoke sessions immediately.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key. |
| `username` | TEXT | The admin user the session belongs to. |
| `created_at` | TEXT | Creation timestamp. |
| `expires_at` | TEXT | Expiry timestamp. |

### api_keys

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key. |
| `name` | TEXT | Human-readable label. |
| `key_hash` | TEXT | SHA-256 hash of the API key. Never stored in plain text. |
| `expires_at` | TEXT | Optional expiry. |
| `last_used_at` | TEXT | Last successful use. Nullable. |
| `revoked_at` | TEXT | Set when the key is revoked. |
| `created_at` | TEXT | Creation timestamp. |

### imports

History of bulk imports (one row per import operation).

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key. |
| `source_url` | TEXT | Feed or file URL the import came from. Nullable. |
| `format` | TEXT | `rss`, `opml`, `netscape`, or `text`. |
| `queued` | INTEGER | URLs queued for archiving. |
| `skipped` | INTEGER | URLs skipped (already archived). |
| `created_at` | TEXT | Creation timestamp. |

### snapshots_fts (virtual)

SQLite FTS5 virtual table for full-text search. Its `rowid` is the snapshot id.

```sql
CREATE VIRTUAL TABLE snapshots_fts USING fts5(
  url,
  title,
  text_content,
  tags
);
```

A snapshot is indexed when it finishes as `done`, from its readability output. Tag names are part of the index and are kept in sync when tags are added to or removed from a snapshot after archiving. Rebuild the whole index with `webfrost search:rebuild`.

## Indexes

| Index | On |
|---|---|
| `idx_archive_results_snapshot` | `archive_results (snapshot_id, extractor)` |
| `idx_job_queue_snapshot` | `job_queue (snapshot_id)` |
| `idx_snapshots_url` | `snapshots (url)` |
| `idx_snapshots_status` | `snapshots (status)` |
| `idx_snapshots_created_at` | `snapshots (created_at)` |
| `idx_snapshot_tags_tag` | `snapshot_tags (tag_id)` |
| `idx_schedules_next_run` | `schedules (next_run_at)` |
| `idx_api_keys_hash` | `api_keys (key_hash)` |

## Direct access

You can query `archive.db` directly with any SQLite client:

```bash
sqlite3 ./data/archive.db ".tables"
sqlite3 ./data/archive.db "SELECT url, status, created_at FROM snapshots ORDER BY created_at DESC LIMIT 10;"
```
