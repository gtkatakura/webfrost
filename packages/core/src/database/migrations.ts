import type Database from "bun:sqlite";

/**
 * Schema versions.
 *
 * The version numbers are shared by every dialect: version N means the same
 * tables and columns on SQLite, PostgreSQL and MySQL.
 *
 * - 1–2: the schema of every release up to 0.1.0 (SQLite only). Version 2 is
 *   what `PRAGMA user_version` holds in archives created before multi-database
 *   support; the step is idempotent, so it also repairs older layouts.
 * - 3: `archive_results.size_bytes` (stored file size, so stats no longer ask
 *   storage about every artifact) and `job_queue.lease_token` (lease fencing).
 *   PostgreSQL and MySQL start here, with the full schema in one step.
 * - 4: `snapshots.color_scheme`, the light or dark preference the browser
 *   archived the page with (NULL: the server default, WEBFROST_COLOR_SCHEME).
 *
 * Add a step by appending to each dialect's list with the next number. Steps
 * run in order, each once, under a lock (BEGIN IMMEDIATE on SQLite, an advisory
 * lock on PostgreSQL, GET_LOCK on MySQL), so concurrent processes are safe.
 */
export const SCHEMA_VERSION = 4;

/** Extractors whose `content` holds a storage reference rather than the data itself. */
export const FILE_BACKED_EXTRACTORS = [
  "screenshot",
  "pdf",
  "warc",
  "dom-snapshot",
  "singlefile",
  "media",
  "media-metadata",
] as const;

const FILE_BACKED_SQL_LIST = FILE_BACKED_EXTRACTORS.map((e) => `'${e}'`).join(", ");

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

/** Run `sql`, ignoring the "duplicate column" error an already-migrated archive raises. */
function addColumn(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
  }
}

/** Schema version 2: unchanged from the pre-0.1.0 `migrate()` so existing archives stay byte-compatible. */
function sqliteV2(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS archive_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
      extractor TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      cron TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS snapshot_tags (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (snapshot_id, tag_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS snapshots_fts USING fts5(
      url,
      title,
      text_content,
      tags
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      source_url TEXT,
      format TEXT NOT NULL,
      queued INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
  `);

  // 'kind' distinguishes url vs rss_feed schedules.
  addColumn(db, "ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'url'");
  // Pause/resume and status tracking for schedules.
  addColumn(db, "ALTER TABLE schedules ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE schedules ADD COLUMN last_status TEXT");
  addColumn(db, "ALTER TABLE schedules ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0");
  // Per-extractor timing and error tracking.
  addColumn(db, "ALTER TABLE archive_results ADD COLUMN duration_ms INTEGER");
  addColumn(db, "ALTER TABLE archive_results ADD COLUMN error TEXT");
  // Job lease: a live pipeline keeps heartbeat_at fresh so another process does not
  // mistake its snapshot for an orphan; attempts caps how often a job is re-queued.
  addColumn(db, "ALTER TABLE job_queue ADD COLUMN heartbeat_at TEXT");
  addColumn(db, "ALTER TABLE job_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_archive_results_snapshot
      ON archive_results (snapshot_id, extractor);
    CREATE INDEX IF NOT EXISTS idx_job_queue_snapshot ON job_queue (snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots (url);
    CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots (status);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots (created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshot_tags_tag ON snapshot_tags (tag_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
  `);
}

function sqliteV3(db: Database): void {
  addColumn(db, "ALTER TABLE archive_results ADD COLUMN size_bytes INTEGER");
  addColumn(db, "ALTER TABLE job_queue ADD COLUMN lease_token TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_job_queue_lease ON job_queue (lease_token)");
  // Inline results know their size already. File-backed ones are measured once,
  // the first time stats need them (see getStats), and stored from then on.
  db.exec(`
    UPDATE archive_results
       SET size_bytes = length(CAST(content AS BLOB))
     WHERE size_bytes IS NULL AND error IS NULL AND content IS NOT NULL
       AND extractor NOT IN (${FILE_BACKED_SQL_LIST})
  `);
}

/** SQLite steps, indexed by the version they bring the archive to. */
export const SQLITE_MIGRATIONS: ReadonlyArray<{ version: number; up: (db: Database) => void }> = [
  { version: 2, up: sqliteV2 },
  { version: 3, up: sqliteV3 },
  { version: 4, up: (db) => addColumn(db, "ALTER TABLE snapshots ADD COLUMN color_scheme TEXT") },
];

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

/** UTC "YYYY-MM-DD HH:MM:SS", the text format SQLite's datetime('now') produces. */
const PG_NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

const PG_V3 = [
  `CREATE TABLE IF NOT EXISTS snapshots (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     url TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at TEXT NOT NULL DEFAULT ${PG_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS archive_results (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     snapshot_id BIGINT NOT NULL REFERENCES snapshots(id),
     extractor TEXT NOT NULL,
     content TEXT,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW},
     duration_ms INTEGER,
     error TEXT,
     size_bytes BIGINT
   )`,
  `CREATE TABLE IF NOT EXISTS job_queue (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     snapshot_id BIGINT NOT NULL REFERENCES snapshots(id),
     status TEXT NOT NULL DEFAULT 'pending',
     created_at TEXT NOT NULL DEFAULT ${PG_NOW},
     heartbeat_at TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     lease_token TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS schedules (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     url TEXT NOT NULL,
     cron TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW},
     last_run_at TEXT,
     next_run_at TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'url',
     paused INTEGER NOT NULL DEFAULT 0,
     last_status TEXT,
     consecutive_failures INTEGER NOT NULL DEFAULT 0
   )`,
  // "C" collation: byte order and case-sensitive comparison, as in SQLite.
  `CREATE TABLE IF NOT EXISTS tags (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     name TEXT COLLATE "C" NOT NULL UNIQUE,
     slug TEXT COLLATE "C" NOT NULL UNIQUE,
     color TEXT,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_tags (
     snapshot_id BIGINT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
     tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (snapshot_id, tag_id)
   )`,
  `CREATE TABLE IF NOT EXISTS admin_users (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     username TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     key_hash TEXT NOT NULL,
     expires_at TEXT,
     last_used_at TEXT,
     revoked_at TEXT,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS imports (
     id TEXT PRIMARY KEY,
     source_url TEXT,
     format TEXT NOT NULL,
     queued INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT ${PG_NOW},
     expires_at TEXT NOT NULL
   )`,
  // Full-text index. `search_text` is the normalised token stream of url, title,
  // text and tags (see search.ts), so tokenisation matches SQLite's FTS5 unicode61.
  `CREATE TABLE IF NOT EXISTS search_index (
     snapshot_id BIGINT PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE,
     url TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     text_content TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '',
     search_text TEXT NOT NULL DEFAULT '',
     search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, search_text)) STORED
   )`,
  "CREATE INDEX IF NOT EXISTS idx_search_index_vector ON search_index USING GIN (search_vector)",
  "CREATE INDEX IF NOT EXISTS idx_archive_results_snapshot ON archive_results (snapshot_id, extractor)",
  "CREATE INDEX IF NOT EXISTS idx_job_queue_snapshot ON job_queue (snapshot_id)",
  "CREATE INDEX IF NOT EXISTS idx_job_queue_lease ON job_queue (lease_token)",
  "CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots (url)",
  "CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots (status)",
  "CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots (created_at)",
  "CREATE INDEX IF NOT EXISTS idx_snapshot_tags_tag ON snapshot_tags (tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at)",
  "CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash)",
];

export const POSTGRES_MIGRATIONS: ReadonlyArray<{ version: number; statements: string[] }> = [
  { version: 3, statements: PG_V3 },
  {
    version: 4,
    statements: ["ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS color_scheme VARCHAR(8)"],
  },
];

// ---------------------------------------------------------------------------
// MySQL (8.0.13+: expression defaults)
// ---------------------------------------------------------------------------

const MY_NOW = "(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))";
/** Binary collation: case-sensitive comparison and byte ordering, as in SQLite. */
const MY_TABLE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";

// MySQL cannot index TEXT without a prefix and DDL is not transactional, so every
// index is declared inline: each CREATE TABLE IF NOT EXISTS is then all-or-nothing.
const MY_V3 = [
  `CREATE TABLE IF NOT EXISTS snapshots (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     url TEXT NOT NULL,
     status VARCHAR(32) NOT NULL DEFAULT 'pending',
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     KEY idx_snapshots_url (url(255)),
     KEY idx_snapshots_status (status),
     KEY idx_snapshots_created_at (created_at)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS archive_results (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     snapshot_id BIGINT NOT NULL,
     extractor VARCHAR(64) NOT NULL,
     content LONGTEXT,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     duration_ms INT,
     error MEDIUMTEXT,
     size_bytes BIGINT,
     KEY idx_archive_results_snapshot (snapshot_id, extractor),
     CONSTRAINT fk_archive_results_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS job_queue (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     snapshot_id BIGINT NOT NULL,
     status VARCHAR(32) NOT NULL DEFAULT 'pending',
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     heartbeat_at VARCHAR(32),
     attempts INT NOT NULL DEFAULT 0,
     lease_token VARCHAR(64),
     KEY idx_job_queue_snapshot (snapshot_id),
     KEY idx_job_queue_lease (lease_token),
     CONSTRAINT fk_job_queue_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS schedules (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     url TEXT NOT NULL,
     cron TEXT NOT NULL,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     last_run_at VARCHAR(32),
     next_run_at VARCHAR(32) NOT NULL,
     kind VARCHAR(32) NOT NULL DEFAULT 'url',
     paused INT NOT NULL DEFAULT 0,
     last_status VARCHAR(32),
     consecutive_failures INT NOT NULL DEFAULT 0,
     KEY idx_schedules_next_run (next_run_at)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS tags (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     slug VARCHAR(255) NOT NULL,
     color TEXT,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     UNIQUE KEY uq_tags_name (name),
     UNIQUE KEY uq_tags_slug (slug)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS snapshot_tags (
     snapshot_id BIGINT NOT NULL,
     tag_id BIGINT NOT NULL,
     PRIMARY KEY (snapshot_id, tag_id),
     KEY idx_snapshot_tags_tag (tag_id),
     CONSTRAINT fk_snapshot_tags_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
     CONSTRAINT fk_snapshot_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS admin_users (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     username VARCHAR(255) NOT NULL,
     password_hash TEXT NOT NULL,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     UNIQUE KEY uq_admin_users_username (username)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS api_keys (
     id VARCHAR(64) NOT NULL PRIMARY KEY,
     name TEXT NOT NULL,
     key_hash VARCHAR(128) NOT NULL,
     expires_at VARCHAR(64),
     last_used_at VARCHAR(32),
     revoked_at VARCHAR(32),
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     KEY idx_api_keys_hash (key_hash)
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS imports (
     id VARCHAR(64) NOT NULL PRIMARY KEY,
     source_url TEXT,
     format VARCHAR(32) NOT NULL,
     queued INT NOT NULL DEFAULT 0,
     skipped INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW}
   ) ${MY_TABLE}`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id VARCHAR(64) NOT NULL PRIMARY KEY,
     username VARCHAR(255) NOT NULL,
     created_at VARCHAR(32) NOT NULL DEFAULT ${MY_NOW},
     expires_at VARCHAR(40) NOT NULL
   ) ${MY_TABLE}`,
  // search_text is accent- and case-insensitive for MATCH; the stop-word list is
  // switched off per session before this runs (see openServerDatabase).
  `CREATE TABLE IF NOT EXISTS search_index (
     snapshot_id BIGINT NOT NULL PRIMARY KEY,
     url TEXT NOT NULL,
     title TEXT NOT NULL,
     text_content LONGTEXT NOT NULL,
     tags TEXT NOT NULL,
     search_text LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
     FULLTEXT KEY ft_search_index (search_text),
     CONSTRAINT fk_search_index_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
   ) ${MY_TABLE}`,
];

export const MYSQL_MIGRATIONS: ReadonlyArray<{ version: number; statements: string[] }> = [
  { version: 3, statements: MY_V3 },
  { version: 4, statements: ["ALTER TABLE snapshots ADD COLUMN color_scheme VARCHAR(8)"] },
];
