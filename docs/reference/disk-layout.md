---
title: Disk layout
description: How WebFrost organizes files and the database on disk.
---

# Disk layout

Everything WebFrost stores lives in the directory pointed to by `WEBFROST_DIR`.

## Directory structure

```
$WEBFROST_DIR/
├── archive.db              # SQLite database — all metadata, FTS index, schedules, sessions
└── snapshots/
    └── <snapshot-id>/      # One directory per snapshot (integer id)
        ├── archive.warc        # Raw HTTP archive
        ├── page.pdf            # Full-page PDF
        ├── screenshot.png      # Full-page screenshot
        ├── dom.html            # Serialized DOM
        ├── singlefile.html     # Self-contained offline HTML
        └── media/              # Only when yt-dlp found media
            ├── media.mp4       # Video (or media.mp3 for the audio-only fallback)
            └── media-metadata.json
```

The `html` and `readability` results are stored in the database, not as files.

Not every file is present in every snapshot. Files are only written if the extractor ran and succeeded.

## Snapshot IDs

Each snapshot's directory is named after its integer id, matching the `id` column in the `snapshots` table. The directory is created when the snapshot is first inserted.

## Database location

`archive.db` is always in `WEBFROST_DIR`, regardless of storage backend. With S3 storage, `archive.db` stays local and holds metadata and file references — the actual archive files are in S3.

## S3 key structure

When using the S3 backend, objects are stored at:

```
<S3_PATH_PREFIX>/<snapshot-id>/<filename>
```

Default prefix is `snapshots`, so a screenshot is at `snapshots/42/screenshot.png`.

## Backup

The entire archive is self-contained in `WEBFROST_DIR`. Back it up with:

```bash
rsync -av --progress $WEBFROST_DIR/ /backup/webfrost/
```

Or:

```bash
tar -czf webfrost-backup-$(date +%Y%m%d).tar.gz $WEBFROST_DIR/
```

## Deleting a snapshot

`webfrost delete <id>` (or `DELETE /api/snapshots/:id`) removes the database record and the entire `<snapshot-id>/` directory. There is no trash — deletion is permanent.
