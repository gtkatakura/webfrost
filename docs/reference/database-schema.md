---
title: Database schema
description: SQLite schema reference for WebFrost's archive.db.
---

# Database schema

WebFrost stores all metadata in a SQLite file called `archive.db` in `WEBFROST_DIR`. The schema is managed by migrations in `@webfrost/core`.

## Tables

### snapshots

One row per archived URL.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key. Also used as the snapshot directory name. |
| `url` | TEXT | The archived URL. |
| `status` | TEXT | `pending`, `complete`, or `failed`. |
| `createdAt` | TEXT | ISO 8601 timestamp. |
| `updatedAt` | TEXT | ISO 8601 timestamp. |

### extractor_results

One row per extractor per snapshot.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `snapshotId` | TEXT | Foreign key → `snapshots.id`. |
| `extractor` | TEXT | Extractor name: `warc`, `pdf`, `screenshot`, etc. |
| `filePath` | TEXT | Relative path to the archive file. |
| `mimeType` | TEXT | MIME type of the output file. |
| `createdAt` | TEXT | ISO 8601 timestamp. |

### tags

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `name` | TEXT | Tag name (unique). |
| `color` | TEXT | Hex color string, e.g. `#4f46e5`. Nullable. |
| `createdAt` | TEXT | ISO 8601 timestamp. |

### snapshot_tags

Many-to-many join table between snapshots and tags.

| Column | Type | Description |
|---|---|---|
| `snapshotId` | TEXT | Foreign key → `snapshots.id`. |
| `tagId` | INTEGER | Foreign key → `tags.id`. |

### schedules

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key. |
| `url` | TEXT | URL or RSS feed URL to archive. |
| `cron` | TEXT | Cron expression (5 fields). |
| `type` | TEXT | `url` or `rss`. |
| `paused` | INTEGER | `0` (active) or `1` (paused). |
| `lastRunAt` | TEXT | Last execution timestamp. Nullable. |
| `lastStatus` | TEXT | `success`, `failed`, or null. |
| `consecutiveFailures` | INTEGER | Count of consecutive failures. Resets on success. |
| `createdAt` | TEXT | ISO 8601 timestamp. |

### api_keys

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key. |
| `name` | TEXT | Human-readable label. |
| `keyHash` | TEXT | SHA-256 hash of the API key. Never stored in plain text. |
| `createdAt` | TEXT | ISO 8601 timestamp. |

### import_history

Tracks previously imported URLs to avoid re-archiving on subsequent imports.

| Column | Type | Description |
|---|---|---|
| `url` | TEXT | Imported URL (primary key). |
| `importedAt` | TEXT | ISO 8601 timestamp. |

### fts_index (virtual)

SQLite FTS5 virtual table for full-text search across extracted content.

```sql
CREATE VIRTUAL TABLE fts_index USING fts5(
  snapshotId,
  url,
  title,
  content
);
```

Populated from `readability.json` when a snapshot completes. Rebuilt with `webfrost search:rebuild`.

## Direct access

You can query `archive.db` directly with any SQLite client:

```bash
sqlite3 ./data/archive.db ".tables"
sqlite3 ./data/archive.db "SELECT url, status, createdAt FROM snapshots ORDER BY createdAt DESC LIMIT 10;"
```
