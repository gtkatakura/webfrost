---
title: Scheduled archiving
description: Set up recurring archive jobs using cron expressions.
---

# Scheduled archiving

Archive URLs or RSS feeds on a recurring schedule using standard cron expressions.

## Add a schedule

```bash
# Archive a URL every day at midnight
WEBFROST_DIR=./data webfrost schedule add https://example.com/news --cron "0 0 * * *"

# Archive an RSS feed every hour
WEBFROST_DIR=./data webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"
```

**Cron syntax:** five fields — `minute hour day-of-month month day-of-week`. Cron expressions are evaluated in the time zone of the process that runs the schedule (`TZ`; the system time zone, which is UTC in the Docker image). Set `TZ` (for example `TZ=America/Sao_Paulo`) to change it.

Common expressions:

| Expression | Meaning |
|---|---|
| `0 * * * *` | Every hour |
| `0 0 * * *` | Every day at midnight |
| `0 9 * * 1` | Every Monday at 9 AM |
| `*/15 * * * *` | Every 15 minutes |

## Who runs the schedules

The server (`@webfrost/server`) runs due schedules itself, polling every 30 seconds — no extra process is needed. Set `WEBFROST_SCHEDULER=false` to disable that.

Without the server (CLI-only use), run a worker:

```bash
WEBFROST_DIR=./data webfrost schedule worker
```

Run this as a persistent background process (systemd, Docker, or a process manager).

::: tip
A worker and the server can run against the same archive at the same time: a due schedule is claimed atomically, so only one of them runs it. Set `WEBFROST_SCHEDULER=false` on the server if the worker should be the only one.
:::

## List and remove schedules

```bash
WEBFROST_DIR=./data webfrost schedule list
WEBFROST_DIR=./data webfrost schedule remove <id>
```

## Manage via REST API

```bash
# Create
curl -X POST http://localhost:3000/api/schedules \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/news", "cron": "0 0 * * *"}'

# Pause
curl -X PATCH http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"paused": true}'

# Resume
curl -X PATCH http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"paused": false}'

# Delete
curl -X DELETE http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here"
```

## Failure handling

Each schedule tracks `lastStatus` and `consecutiveFailures`. Failed schedules stay active and retry on the next scheduled run. Pause a schedule manually if you want to stop retries.
