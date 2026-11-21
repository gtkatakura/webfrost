---
"@webfrost/core": minor
"@webfrost/cli": minor
"@webfrost/server": minor
---

PostgreSQL and MySQL support, next to SQLite.

**Added**

- `DATABASE_URL` selects the metadata database: `postgres://…` (PostgreSQL 13+), `mysql://…` (MySQL 8.0.13+) or `sqlite://…` / a file path. Without it nothing changes: SQLite at `$WEBFROST_DIR/archive.db`. Archive files stay on the configured storage backend (filesystem or S3) whichever database is used. The schema is created and migrated automatically on first start.
- Full-text search on every engine: SQLite keeps FTS5; PostgreSQL uses a `tsvector` column with a GIN index, MySQL a `FULLTEXT` index. Both index URL, title, text and tags with the same tokenisation as FTS5, accept the common query syntax (words, `"phrases"`, `prefix*`, `OR`, `NOT`/`-word`) and return snippets with the same HTML-escaped `<mark>` contract. `rank` is lower-is-better everywhere.
- Connection pools for PostgreSQL/MySQL (`WEBFROST_DB_POOL_MAX`, `WEBFROST_DB_POOL_IDLE_MS`), closed on graceful shutdown.
- Optional Litestream service in `docker-compose.prod.yml` (`--profile backup`) that streams `archive.db` to S3-compatible storage, and a new Backups guide (plain files, Litestream, `pg_dump`, `mysqldump`).

**Fixed**

- Lease fencing for archive jobs: a worker that was presumed dead and adopted by another process can no longer overwrite the new run's status or add results to it. Each job carries a lease token that every pipeline write is conditional on.
- Deleting a snapshot and rebuilding or updating the search index now run in transactions.
- The stats endpoint no longer asks the storage backend for the size of every artifact on each call: sizes are stored when results are written (`archive_results.size_bytes`); results from older archives are measured once and stored.

**Changed (may need action)**

- `@webfrost/core`'s database API is asynchronous: `openDb()` returns a promise of a `Db` handle (`await db.close()`), and every function that reads or writes the database returns a promise. `JobRunner.add()` and `JobRunner.recoverPending()` are async; `createSnapshotJob()` returns the snapshot id with its lease token.
- Existing SQLite archives are upgraded in place to schema version 3 on first open (two new columns, no data rewritten except a size backfill). Take a backup before upgrading if you may want to roll back.
