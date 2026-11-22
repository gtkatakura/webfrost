---
"@webfrost/core": patch
---

Cron expressions are validated per field (`60 * * * *` fails at once with an error naming the field) and gain ranges with steps (`1-10/2`), month and weekday names, `7` for Sunday and `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`. When both day-of-month and day-of-week are restricted a day now matches if either does (Vixie cron), as it does in standard cron. Next-run times are correct across DST changes in the process time zone: a skipped local time is skipped for that day and a repeated one fires once.

The S3 backend uploads files from disk without loading them into memory, and keeps its temporary files in a private per-process directory instead of a shared `/tmp/webfrost-s3-tmp`.
