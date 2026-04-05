---
title: Supported sources
description: Input formats WebFrost can archive or import from.
---

# Supported sources

## Single URL

Any HTTP or HTTPS URL. Pass directly to `webfrost add` or `POST /api/snapshots`.

```bash
webfrost add https://example.com/article
webfrost add https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

WebFrost navigates to the URL with Chromium and runs all extractors.

## Bulk import formats

| Format | CLI flag | Extension | Description |
|---|---|---|---|
| Plain text | `--format text` (default) | `.txt` | One URL per line. Blank lines and `#` comments ignored. |
| Netscape bookmarks | `--format netscape` | `.html`, `.htm` | Browser bookmark export. Parses all `<A HREF=...>` entries. |
| OPML | `--format opml` | `.opml` | RSS reader subscription export. Fetches each feed and enqueues all items. |
| RSS/Atom feed | `--format rss` | — | Fetches the feed URL and enqueues each item link. |

Auto-detection: if `--format` is omitted, the format is inferred from the file extension.

## Media URLs

WebFrost uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) for media extraction. Any URL yt-dlp supports is a valid source for the `media` and `media-metadata` extractors:

- YouTube, Vimeo, SoundCloud, Twitch clips, and [thousands more](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

yt-dlp must be installed separately. See [Installation](/getting-started/install).

## RSS feeds (scheduled)

RSS and Atom feeds can be scheduled to archive all items on a cron expression:

```bash
webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"
```

See [Scheduled archiving](/guides/scheduled-archiving).
