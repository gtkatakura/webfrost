# Explanation: Storage model

How WebFrost stores your archive — and why.

---

## Everything in one directory

WebFrost stores all data in the directory pointed to by `WEBFROST_DIR`:

```
$WEBFROST_DIR/
├── archive.db              # SQLite database — all metadata, FTS index
└── <snapshot-id>/          # One directory per snapshot
    ├── response.warc       # Raw HTTP archive
    ├── readability.json    # Extracted article text (title, content, byline)
    ├── page.pdf            # Full-page PDF
    ├── screenshot.png      # Full-page screenshot
    ├── dom-snapshot.json   # Serialized DOM tree
    ├── singlefile.html     # Self-contained offline HTML
    ├── page.html           # Raw HTML source
    ├── media.mp4           # Video/audio (if yt-dlp ran)
    └── media-metadata.json # yt-dlp metadata JSON
```

Not every file is present for every snapshot. Files are only written if the extractor ran and succeeded.

---

## SQLite database

`archive.db` is a standard SQLite file. It contains:

- **snapshots** — one row per archived URL, with status, timestamps, and extractor results.
- **extractor_results** — per-snapshot, per-extractor record with file path and MIME type.
- **tags** and **snapshot_tags** — tag names, colors, and many-to-many associations.
- **schedules** — cron schedule definitions with last-run state and failure tracking.
- **api_keys** — hashed API keys and labels.
- **import_history** — tracks imported URLs to avoid duplicates on re-import.
- **fts_index** — SQLite FTS5 virtual table for full-text search across extracted text.

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
