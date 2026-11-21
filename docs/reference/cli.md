# Reference: CLI

Full command reference for the `webfrost` CLI (`@webfrost/cli`).

**During development** (no global install), prefix all commands with `bun run` and set `WEBFROST_DIR`:

```bash
WEBFROST_DIR=./data bun run webfrost <command>
```

---

## Global flags

```
webfrost --help, -h          Show help and list all commands
webfrost --version, -v       Show CLI version
webfrost --verbose            Enable debug-level output (or set WEBFROST_LOG_LEVEL=debug)
webfrost --quiet              Suppress info output — only warn/error messages shown
webfrost <command> --help     Show help for a specific command
```

---

## Archive commands

### `webfrost init`

Initialize a new archive at `WEBFROST_DIR`. Creates `archive.db`.

```bash
WEBFROST_DIR=./data webfrost init
```

### `webfrost add <url>`

Archive a URL. Runs all extractors: HTML, WARC, Readability, PDF, screenshot, DOM snapshot, SingleFile. The snapshot ends `done` when at least one extractor produced output, otherwise `failed`. If yt-dlp is installed and the URL is a media page, runs media extraction too.

```bash
WEBFROST_DIR=./data webfrost add https://example.com
```

### `webfrost list`

List all snapshots.

```bash
WEBFROST_DIR=./data webfrost list
# 1    done    https://example.com
```

### `webfrost delete <id>`

Delete a snapshot and all its archive files.

```bash
WEBFROST_DIR=./data webfrost delete 1
```

### `webfrost search <query>`

Full-text search across archived content (SQLite FTS5). Returns ranked results with snippets.

```bash
WEBFROST_DIR=./data webfrost search "climate change"
```

### `webfrost search:rebuild`

Rebuild the full-text search index. Use after a failed import or index corruption.

```bash
WEBFROST_DIR=./data webfrost search:rebuild
```

---

## Tag commands

### `webfrost tag add <snapshot-id> <name>`

Add a tag to a snapshot. Creates the tag if it does not exist.

```bash
WEBFROST_DIR=./data webfrost tag add 1 research
```

### `webfrost tag list [<snapshot-id>]`

List all tags, or tags on a specific snapshot.

```bash
WEBFROST_DIR=./data webfrost tag list
WEBFROST_DIR=./data webfrost tag list 1
```

### `webfrost tag create <name> [--color <hex>]`

Create a new tag.

```bash
WEBFROST_DIR=./data webfrost tag create "research" --color "#4f46e5"
```

### `webfrost tag remove <tag-id>`

Delete a tag and remove it from all snapshots.

```bash
WEBFROST_DIR=./data webfrost tag remove <tag-id>
```

---

## Schedule commands

### `webfrost schedule add <url> --cron <expr>`

Add a recurring archive schedule for a URL.

```bash
WEBFROST_DIR=./data webfrost schedule add https://example.com --cron "0 0 * * *"
```

### `webfrost schedule add --rss <feed-url> --cron <expr>`

Add a recurring RSS feed import schedule.

```bash
WEBFROST_DIR=./data webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"
```

### `webfrost schedule list`

List all schedules.

### `webfrost schedule remove <id>`

Remove a schedule.

### `webfrost schedule worker`

Start the schedule worker. It polls every 30 seconds for due schedules and runs them through the same scheduler the server embeds, and re-queues snapshots left `pending` by a previous run at startup. Not needed when running the full server. Safe to run alongside the server on the same archive (due schedules are claimed atomically); set `WEBFROST_SCHEDULER=false` on the server to make the worker the only one. Cron expressions are evaluated in the process time zone (`TZ`).

---

## Import commands

### `webfrost import [--format=<fmt>] <url-or-file>`

Bulk import URLs from a file or feed URL.

```bash
# Plain text (one URL per line)
WEBFROST_DIR=./data webfrost import urls.txt

# OPML feed list
WEBFROST_DIR=./data webfrost import subscriptions.opml

# Netscape bookmark HTML
WEBFROST_DIR=./data webfrost import bookmarks.html

# RSS feed URL
WEBFROST_DIR=./data webfrost import --format=rss https://example.com/feed.xml
```

Supported `--format=` values: `text`, `opml`, `netscape`, `rss`. Auto-detected from file extension if omitted.

---

## Admin commands

### `webfrost admin create --username <name> --password <pass>`

Create the admin user and default API key. Run once on first setup. The password must be at least 8 characters. (With the Docker image there is no CLI inside the container: create the admin user in the browser setup wizard or via `POST /api/setup`.)

### `webfrost admin key create --name <label>`

Create an additional API key.

### `webfrost admin key list`

List active API keys.

### `webfrost admin key revoke <id>`

Revoke an API key.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_DIR` | `.` (CLI) / `~/.webfrost` (server) | Database and archive files directory |
| `WEBFROST_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `WEBFROST_CONCURRENCY` | `3` | Max parallel archive pipelines (`import`, `schedule worker`) |
| `WEBFROST_DOMAIN_DELAY_MS` | `1000` | Minimum gap between two archives of the same host |
| `WEBFROST_CHROMIUM_PATH` | — | Use an existing Chromium/Chrome binary |

Timeouts, `WEBFROST_ALLOW_PRIVATE_URLS` and the server-only variables are in the full variable reference: [Reference: Environment variables](./environment-variables.md)
