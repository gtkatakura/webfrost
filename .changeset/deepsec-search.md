---
"@webfrost/core": patch
"@webfrost/server": patch
---

Search and listing are harder to abuse or break. `page` and `limit` that are not plain numbers (`Infinity`, `1e400`) answer 400 instead of a 500, and core clamps them to values the database accepts. On PostgreSQL and MySQL, a query is limited to 512 characters and 32 terms, snippets are built from the first 100,000 characters of a document, and characters such as `⑴` or `½` no longer put punctuation inside search tokens. On SQLite a database error is no longer reported as "no results". The size backfill behind `GET /stats` measures 16 files at a time and retries a failed lookup instead of storing 0 bytes.
