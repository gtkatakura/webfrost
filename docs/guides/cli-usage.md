---
title: CLI usage
description: Common CLI workflows and examples for the webfrost command.
---

# CLI usage

Common workflows with the `webfrost` CLI. For the full command reference, see [CLI reference](/reference/cli).

**Development prefix:** When running from source, prefix commands with `bun run` and set `WEBFROST_DIR`:

```bash
WEBFROST_DIR=./data bun run webfrost <command>
```

## Archive a URL

```bash
WEBFROST_DIR=./data webfrost add https://example.com
```

Six extractors run in parallel: WARC, Readability, PDF, screenshot, DOM snapshot, and SingleFile.

## List snapshots

```bash
WEBFROST_DIR=./data webfrost list
```

## Search

Full-text search across all archived content:

```bash
WEBFROST_DIR=./data webfrost search "climate change"
```

Results include a snippet with matched terms highlighted.

## Delete a snapshot

```bash
WEBFROST_DIR=./data webfrost delete abc123
```

Removes the database record and all archive files for that snapshot.

## Tag snapshots

```bash
# Create a tag
WEBFROST_DIR=./data webfrost tag create "research" --color "#4f46e5"

# Add tag to a snapshot
WEBFROST_DIR=./data webfrost tag add abc123 research

# List tags on a snapshot
WEBFROST_DIR=./data webfrost tag list abc123

# List all tags
WEBFROST_DIR=./data webfrost tag list
```

## Import URLs in bulk

```bash
# Plain text (one URL per line)
WEBFROST_DIR=./data webfrost import urls.txt

# Browser bookmarks (Netscape HTML)
WEBFROST_DIR=./data webfrost import bookmarks.html

# RSS feed
WEBFROST_DIR=./data webfrost import --format rss https://example.com/feed.xml
```

See [Bulk import](/guides/bulk-import) for more detail.

## Schedule recurring archives

```bash
# Archive a URL every day at midnight
WEBFROST_DIR=./data webfrost schedule add https://example.com --cron "0 0 * * *"

# Archive an RSS feed every hour
WEBFROST_DIR=./data webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"

# Start the schedule worker (not needed if running the full server)
WEBFROST_DIR=./data webfrost schedule worker
```

See [Scheduled archiving](/guides/scheduled-archiving) for more detail.

## Adjust verbosity

```bash
webfrost --verbose add https://example.com   # Debug output
webfrost --quiet add https://example.com     # Warn/error only
```

Or set `WEBFROST_LOG_LEVEL=debug` as an environment variable.
