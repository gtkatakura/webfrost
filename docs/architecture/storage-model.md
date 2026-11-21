---
title: Storage model
description: How WebFrost stores your archive and why.
---

# Storage model

How WebFrost stores your archive — and why.

## Everything in one directory

WebFrost stores all data in `WEBFROST_DIR`:

```
$WEBFROST_DIR/
├── archive.db              # SQLite database — all metadata, FTS index
└── snapshots/
    └── <snapshot-id>/      # One directory per snapshot (integer id)
        ├── archive.warc        # Raw HTTP archive
        ├── page.pdf            # Full-page PDF
        ├── screenshot.png      # Full-page screenshot
        ├── dom.html            # Serialized DOM
        ├── singlefile.html     # Self-contained offline HTML
        └── media/              # Only when yt-dlp found media
            ├── media.mp4       # Video (or media.mp3 for audio-only)
            └── media-metadata.json
```

The `html` and `readability` results live in the database.

Not every file is present for every snapshot. Files are only written if the extractor ran and succeeded.

## SQLite database

`archive.db` holds all metadata:

- **snapshots** — one row per URL, with status (`pending`, `done` or `failed`) and timestamps
- **archive_results** — per-snapshot, per-extractor record: output (inline content or storage reference), duration, and `error` when the extractor failed
- **job_queue** — background job state per snapshot (`pending`, `running`, `done`, `failed`)
- **tags** and **snapshot_tags** — tag names, colors, and associations
- **schedules** — cron definitions with last-run state and failure tracking
- **admin_users**, **sessions**, **api_keys** — the admin account, server-side login sessions, and hashed API keys
- **imports** — history of bulk imports
- **snapshots_fts** — SQLite FTS5 virtual table for full-text search (URL, title, text, tags)

See [Database schema](/reference/database-schema) for column-level detail.

## Why this design?

**No external dependencies.** SQLite and the local filesystem are all you need. Nothing to install, no database server, no object storage required (S3 is optional).

**Self-contained backup.** The entire archive is one directory. Back it up with `rsync` or `tar`. Restore by copying the directory back.

**Open formats.** WARC is a standard archival format readable by [ReplayWeb.page](https://replayweb.page/), the Wayback Machine, and other tools. PDF, PNG, and HTML need no special software. The SQLite database is readable with any SQLite client.

**No lock-in.** You own the files. If WebFrost goes away, your archive stays. The WARC files alone are sufficient for long-term preservation.

## S3 backend

When `WEBFROST_STORAGE_BACKEND=s3`, archive files are written to S3 instead of the local filesystem. `archive.db` stays local — it stores metadata and file references, not the files themselves.

S3 object key: `<S3_PATH_PREFIX>/<snapshot-id>/<filename>` (default prefix: `snapshots`).

See [Storage backends](/guides/storage-backends) for setup.

## Backing up

```bash
# rsync
rsync -av --progress $WEBFROST_DIR/ /backup/webfrost/

# tar
tar -czf webfrost-backup-$(date +%Y%m%d).tar.gz $WEBFROST_DIR/
```
