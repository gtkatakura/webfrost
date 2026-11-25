---
"@webfrost/core": minor
"@webfrost/server": patch
---

SQLite search now goes through the same query parser as PostgreSQL and MySQL: words, `"phrase"`, `term*`, `OR` and `NOT` / `-term`, up to 512 characters and 32 terms. A query of thousands of `a*` terms or `NEAR` groups can no longer stall the server, which runs SQLite on its main thread. FTS5-only syntax (`NEAR`, `col:term`) is no longer taken: `title:x` searches every field for `x`. `q` longer than 1024 characters answers `400`.
