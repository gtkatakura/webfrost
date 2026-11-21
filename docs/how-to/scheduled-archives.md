# How-to: Scheduled Archives

Set up recurring archive jobs using cron expressions.

---

## Add a schedule

```bash
# Archive a URL every day at midnight
WEBFROST_DIR=./data webfrost schedule add https://example.com/news --cron "0 0 * * *"

# Archive an RSS feed every hour
WEBFROST_DIR=./data webfrost schedule add --rss https://example.com/feed.xml --cron "0 * * * *"
```

Standard 5-field cron syntax: `minute hour day-of-month month day-of-week`. Cron expressions are evaluated in the time zone of the process that runs the schedule (`TZ`; the system time zone, which is UTC in the Docker image). Set `TZ` (for example `TZ=America/Sao_Paulo`) to change it.

Common expressions:

| Expression | Meaning |
|---|---|
| `0 * * * *` | Every hour |
| `0 0 * * *` | Every day at midnight |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |

---

## List schedules

```bash
WEBFROST_DIR=./data webfrost schedule list
```

Output includes the schedule ID, URL, cron expression, last status, and consecutive failure count.

---

## Who runs the schedules

The server (`@webfrost/server`) runs due schedules itself: it starts the scheduler at boot and polls every 30 seconds. Schedules created in the web UI or via the API fire without any extra process. Set `WEBFROST_SCHEDULER=false` to disable this.

Without the server (CLI-only use), start a worker:

```bash
WEBFROST_DIR=./data webfrost schedule worker
```

Run it as a persistent background process (systemd, Docker, or a process manager). It uses the same scheduler as the server and re-queues snapshots left `pending` by a previous run when it starts.

Running a worker next to the server on the same archive is safe: a due schedule is claimed atomically, so only one of them runs it. Set `WEBFROST_SCHEDULER=false` on the server if you want the worker to be the only one.

---

## Manage schedules via the REST API

```bash
# Create a schedule
curl -X POST http://localhost:3000/api/schedules \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/news", "cron": "0 0 * * *"}'

# List schedules
curl http://localhost:3000/api/schedules \
  -H "Authorization: Bearer wf_your_api_key_here"

# Pause a schedule
curl -X PATCH http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"paused": true}'

# Resume a schedule
curl -X PATCH http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"paused": false}'

# Remove a schedule
curl -X DELETE http://localhost:3000/api/schedules/<id> \
  -H "Authorization: Bearer wf_your_api_key_here"
```

---

## Remove a schedule

```bash
WEBFROST_DIR=./data webfrost schedule remove <id>
```

---

## Failure handling

The schedule list shows `lastStatus` and `consecutiveFailures`. Failed schedules remain active — they retry on the next scheduled run. There is no automatic disabling on failure; you can pause a schedule manually via the API or UI if needed.
