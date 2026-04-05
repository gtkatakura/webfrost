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

**Cron syntax:** five fields — `minute hour day-of-month month day-of-week`.

Common expressions:

| Expression | Meaning |
|---|---|
| `0 * * * *` | Every hour |
| `0 0 * * *` | Every day at midnight |
| `0 9 * * 1` | Every Monday at 9 AM |
| `*/15 * * * *` | Every 15 minutes |

## Run the schedule worker

Schedules require a worker process watching the database:

```bash
WEBFROST_DIR=./data webfrost schedule worker
```

Run this as a persistent background process (systemd, Docker, or a process manager).

::: tip
If you are running the full server (`@webfrost/server`), the schedule worker is embedded — you do not need to start it separately.
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
