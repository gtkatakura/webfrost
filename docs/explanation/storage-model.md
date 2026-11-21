# Explanation: Storage model

How WebFrost stores your archive — and why.

---

## Everything in one directory

WebFrost stores all data in the directory pointed to by `WEBFROST_DIR`:

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

---

## SQLite database

`archive.db` is a standard SQLite file. It contains:

- **snapshots** — one row per URL, with status (`pending`, `done` or `failed`) and timestamps
- **archive_results** — per-snapshot, per-extractor record: output (inline content or storage reference), duration, and `error` when the extractor failed
- **job_queue** — background job state per snapshot (`pending`, `running`, `done`, `failed`)
- **tags** and **snapshot_tags** — tag names, colors, and associations
- **schedules** — cron definitions with last-run state and failure tracking
- **admin_users**, **sessions**, **api_keys** — the admin account, server-side login sessions, and hashed API keys
- **imports** — history of bulk imports
- **snapshots_fts** — SQLite FTS5 virtual table for full-text search (URL, title, text, tags)

---

## Why this design?

**No external dependencies.** SQLite and the local filesystem are all you need. There is nothing to install, no database server to run, no object storage bucket to configure. Clone, run, archive.

**Self-contained backup.** The entire archive is one directory. Back it up with `rsync`, `tar`, or a standard file backup tool. Restore by copying the directory back.

**Open formats.** WARC is a standard archival format readable by [ReplayWeb.page](https://replayweb.page/), Wayback Machine, and other tools. PDF, PNG, and HTML need no special software. The SQLite database is readable with any SQLite client.

**No lock-in.** You own the files. If WebFrost goes away, your archive stays. The WARC files alone are sufficient for long-term preservation — everything else is derived from them.

---

## Future: S3 storage

S3/remote storage support is on the roadmap. When it ships, archive files will be written to S3 instead of the local filesystem. The SQLite database will remain local (it stores metadata and file references, not the files themselves).

See [How-to: S3 storage](../how-to/s3-storage.md) for status.

---

## Backing up your archive

```bash
# Simple rsync backup
rsync -av --progress $WEBFROST_DIR/ /backup/webfrost/

# Or tar
tar -czf webfrost-backup-$(date +%Y%m%d).tar.gz $WEBFROST_DIR/
```

The `archive.db` file can be backed up while the server is running using SQLite's online backup API, but for simplicity, stopping the server before backup avoids any write-during-backup concerns.
