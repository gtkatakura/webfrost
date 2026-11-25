import Database from "bun:sqlite";
import {
  CompiledQuery,
  Kysely,
  MysqlDialect,
  PostgresDialect,
  type RawBuilder,
  type Transaction,
  sql,
} from "kysely";
import { BunSqliteDialect } from "./database/bun-sqlite-dialect";
import {
  type DatabaseConfig,
  type DialectName,
  databaseKey,
  parseDatabaseUrl,
  resolveDatabaseConfig,
  testDatabaseName,
} from "./database/config";
import { MYSQL_MIGRATIONS, POSTGRES_MIGRATIONS, SQLITE_MIGRATIONS } from "./database/migrations";
import type { Schema } from "./database/schema";
import { recordMetric, traceDialect } from "./telemetry";

export type { DatabaseConfig, DialectName } from "./database/config";
export { parseDatabaseUrl, resolveDatabaseConfig } from "./database/config";
export type { Schema } from "./database/schema";
export { SCHEMA_VERSION } from "./database/migrations";

/**
 * A handle on the archive database, whichever engine holds it.
 *
 * Every function in @webfrost/core takes one. Get it from `openDb(dir)` and
 * `close()` it when the unit of work (a request, a job, a CLI command) is done.
 * On SQLite the handles of one process share a connection, closed with the last
 * handle; on PostgreSQL and MySQL a handle borrows from a per-process pool and
 * `close()` has nothing to close — call `closeDatabases()` at shutdown to end
 * the pools.
 */
export interface Db {
  readonly dialect: DialectName;
  /** Identity of the underlying database (no credentials), for per-process bookkeeping. */
  readonly key: string;
  /** Kysely query builder bound to this handle (or to its transaction). */
  readonly kysely: Kysely<Schema>;
  /** Rows of a query built with Kysely's `sql` template. */
  all<T>(query: RawBuilder<T>): Promise<T[]>;
  /** First row, or null. */
  get<T>(query: RawBuilder<T>): Promise<T | null>;
  /** Execute a statement; resolves to the number of rows it affected (matched, on MySQL). */
  run(query: RawBuilder<unknown>): Promise<number>;
  /** Execute an INSERT into a table with an `id` column and return the new id. */
  insert(query: RawBuilder<unknown>): Promise<number>;
  /**
   * Run `fn` in a transaction (BEGIN IMMEDIATE on SQLite). Deadlocks and
   * "database is locked" are retried, so `fn` must only touch the database.
   * Nested calls join the outer transaction.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Current UTC time as "YYYY-MM-DD HH:MM:SS", from the database clock. */
  now(): RawBuilder<string>;
  /** UTC time `seconds` ago, same format. */
  ago(seconds: number): RawBuilder<string>;
  /** Today's UTC date as "YYYY-MM-DD". */
  today(): RawBuilder<string>;
  /** `FOR UPDATE [OF alias] SKIP LOCKED` on PostgreSQL/MySQL; nothing on SQLite (one writer at a time). */
  forUpdateSkipLocked(alias?: string): RawBuilder<unknown>;
  /** `FOR SHARE` on PostgreSQL/MySQL; nothing on SQLite. */
  forShare(): RawBuilder<unknown>;
  /** `FOR UPDATE` on PostgreSQL/MySQL; nothing on SQLite (one writer at a time). */
  forUpdate(): RawBuilder<unknown>;
  close(): Promise<void>;
}

/** How many times a transaction that hit a deadlock or a busy database is retried. */
const TRANSACTION_RETRIES = 5;

class KyselyDb implements Db {
  constructor(
    readonly dialect: DialectName,
    readonly key: string,
    readonly kysely: Kysely<Schema>,
    private readonly onClose: () => Promise<void>,
    private readonly inTransaction = false,
  ) {}

  async all<T>(query: RawBuilder<T>): Promise<T[]> {
    return (await query.execute(this.kysely)).rows;
  }

  async get<T>(query: RawBuilder<T>): Promise<T | null> {
    return (await query.execute(this.kysely)).rows[0] ?? null;
  }

  async run(query: RawBuilder<unknown>): Promise<number> {
    return Number((await query.execute(this.kysely)).numAffectedRows ?? 0n);
  }

  async insert(query: RawBuilder<unknown>): Promise<number> {
    if (this.dialect === "postgres") {
      const row = await this.get(sql<{ id: number }>`${query} RETURNING id`);
      if (!row) throw new Error("insert returned no id");
      return Number(row.id);
    }
    const result = await query.execute(this.kysely);
    if (result.insertId === undefined) throw new Error("insert returned no id");
    return Number(result.insertId);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.kysely
          .transaction()
          .execute((trx: Transaction<Schema>) =>
            fn(new KyselyDb(this.dialect, this.key, trx, async () => {}, true)),
          );
      } catch (err) {
        if (!isTransientError(err) || attempt >= TRANSACTION_RETRIES) throw err;
        recordMetric("db.transaction.retries", 1, {
          "db.system.name": this.dialect === "postgres" ? "postgresql" : this.dialect,
        });
        await Bun.sleep(10 + Math.random() * 40 * (attempt + 1));
      }
    }
  }

  now(): RawBuilder<string> {
    switch (this.dialect) {
      case "sqlite":
        return sql<string>`datetime('now')`;
      case "postgres":
        return sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
      case "mysql":
        return sql<string>`DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')`;
    }
  }

  ago(seconds: number): RawBuilder<string> {
    const s = Math.trunc(seconds);
    if (!Number.isFinite(s)) throw new Error(`invalid interval: ${seconds}`);
    switch (this.dialect) {
      case "sqlite":
        return sql<string>`datetime('now', ${sql.lit(`${-s} seconds`)})`;
      case "postgres":
        return sql<string>`to_char(now() AT TIME ZONE 'UTC' - make_interval(secs => ${sql.lit(s)}), 'YYYY-MM-DD HH24:MI:SS')`;
      case "mysql":
        return sql<string>`DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL ${sql.lit(s)} SECOND, '%Y-%m-%d %H:%i:%s')`;
    }
  }

  today(): RawBuilder<string> {
    switch (this.dialect) {
      case "sqlite":
        return sql<string>`date('now')`;
      case "postgres":
        return sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
      case "mysql":
        return sql<string>`DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d')`;
    }
  }

  forUpdateSkipLocked(alias?: string): RawBuilder<unknown> {
    if (this.dialect === "sqlite") return sql``;
    return alias ? sql`FOR UPDATE OF ${sql.raw(alias)} SKIP LOCKED` : sql`FOR UPDATE SKIP LOCKED`;
  }

  forShare(): RawBuilder<unknown> {
    return this.dialect === "sqlite" ? sql`` : sql`FOR SHARE`;
  }

  forUpdate(): RawBuilder<unknown> {
    return this.dialect === "sqlite" ? sql`` : sql`FOR UPDATE`;
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface DriverError {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
}

/** Deadlock, serialization failure, lock wait timeout or SQLITE_BUSY: worth retrying. */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, errno, message } = err as DriverError;
  if (code === "40P01" || code === "40001") return true; // PostgreSQL
  if (errno === 1213 || errno === 1205) return true; // MySQL
  return typeof message === "string" && /database is locked|SQLITE_BUSY/i.test(message);
}

/** A UNIQUE / PRIMARY KEY violation, on any dialect. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, errno, message } = err as DriverError;
  if (code === "23505" || errno === 1062) return true;
  return typeof message === "string" && /UNIQUE constraint failed/i.test(message);
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

/** How many times to retry opening an archive that another process holds locked. */
const OPEN_RETRIES = 60;

function schemaVersion(db: Database): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

function openSqliteFile(path: string): Database {
  const db = new Database(path);
  try {
    // Wait for a competing writer instead of failing with SQLITE_BUSY: the server,
    // background pipelines and the CLI all open their own connections.
    db.exec("PRAGMA busy_timeout = 5000;");
    // WAL, and no manual checkpoints anywhere: SQLite's automatic checkpoints are
    // what Litestream expects, so the archive can be replicated while it is in use.
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    // The schema is applied once per archive, not on every connection: the server
    // opens a connection per request, and re-running the DDL there is pure overhead.
    for (const step of SQLITE_MIGRATIONS) {
      if (schemaVersion(db) >= step.version) continue;
      // One writer at a time: take the write lock, then look again — another
      // process may have finished the migration while this one was waiting.
      db.exec("BEGIN IMMEDIATE;");
      try {
        if (schemaVersion(db) < step.version) {
          step.up(db);
          db.exec(`PRAGMA user_version = ${step.version};`);
        }
        db.exec("COMMIT;");
      } catch (err) {
        db.exec("ROLLBACK;");
        throw err;
      }
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

async function openSqlite(path: string): Promise<Database> {
  // Several processes opening a brand-new archive at once (server + CLI, parallel
  // CLI runs) collide on the switch to WAL and on the first migration, and SQLite
  // reports that as "database is locked" without consulting busy_timeout. Retry.
  for (let attempt = 0; ; attempt++) {
    try {
      return openSqliteFile(path);
    } catch (err) {
      if (!isTransientError(err) || attempt >= OPEN_RETRIES) throw err;
      await Bun.sleep(10 + Math.min(attempt, 10) * 10);
    }
  }
}

interface SqliteEntry {
  ready: Promise<Kysely<Schema>>;
  refs: number;
}

const sqliteDatabases = new Map<string, SqliteEntry>();

/**
 * Handles on the same archive file within one process share one connection,
 * opened by the first and closed with the last. Kysely serialises statements on
 * it and a transaction holds it until it commits.
 *
 * Separate connections would deadlock: SQLite's busy handler waits
 * synchronously, so a write on a second connection while the first sits in a
 * transaction between two awaits would block the very event loop that has to
 * finish that transaction (until busy_timeout gives up). Other processes still
 * use their own connections, coordinated by busy_timeout and BEGIN IMMEDIATE.
 */
async function acquireSqlite(
  path: string,
): Promise<{ kysely: Kysely<Schema>; release: () => Promise<void> }> {
  let entry = sqliteDatabases.get(path);
  if (!entry) {
    const created: SqliteEntry = {
      ready: openSqlite(path).then(
        (database) =>
          new Kysely<Schema>({ dialect: traceDialect(new BunSqliteDialect(database), "sqlite") }),
      ),
      refs: 0,
    };
    created.ready.catch(() => {
      if (sqliteDatabases.get(path) === created) sqliteDatabases.delete(path);
    });
    sqliteDatabases.set(path, created);
    entry = created;
  }
  const own = entry;
  own.refs++;
  let kysely: Kysely<Schema>;
  try {
    kysely = await own.ready;
  } catch (err) {
    own.refs--;
    throw err;
  }
  let released = false;
  return {
    kysely,
    release: async () => {
      if (released) return;
      released = true;
      own.refs--;
      if (own.refs === 0 && sqliteDatabases.get(path) === own) {
        sqliteDatabases.delete(path);
        await kysely.destroy();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL / MySQL
// ---------------------------------------------------------------------------

/** One pool per database URL per process; migrated once, on first use. */
const serverDatabases = new Map<string, Promise<Kysely<Schema>>>();

function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Pool sizing: WEBFROST_DB_POOL_MAX connections per process, idle ones closed after WEBFROST_DB_POOL_IDLE_MS. */
function poolSettings(env = process.env): { max: number; idleMs: number } {
  // Test suites map every temp directory to its own schema, hence its own pool:
  // keep those small and short-lived so a run never exhausts the server's connections.
  const testing = Boolean(env.WEBFROST_TEST_DATABASE_URL);
  return {
    max: envInt(env, "WEBFROST_DB_POOL_MAX", testing ? 3 : 10),
    idleMs: envInt(env, "WEBFROST_DB_POOL_IDLE_MS", testing ? 1_000 : 30_000),
  };
}

async function createPostgres(url: string): Promise<Kysely<Schema>> {
  const pg = (await import("pg")).default;
  const { max, idleMs } = poolSettings();
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: idleMs,
    // Idle connections do not keep a CLI process alive.
    allowExitOnIdle: true,
    types: {
      // COUNT/SUM and BIGINT ids come back as numbers, as they do from SQLite.
      getTypeParser: ((oid: number, format?: string) =>
        oid === 20 || oid === 1700
          ? (value: string) => Number(value)
          : pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser,
    },
  });
  // A dropped idle connection must not crash the process; the next query reconnects.
  pool.on("error", () => {});
  return new Kysely<Schema>({ dialect: traceDialect(new PostgresDialect({ pool }), "postgres") });
}

async function createMysql(url: string): Promise<Kysely<Schema>> {
  const mysql = await import("mysql2");
  const { max, idleMs } = poolSettings();
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: max,
    // mysql2 only reaps idle connections when maxIdle < connectionLimit. Keep a couple
    // warm and close the rest — and any idle longer than idleTimeout — so neither a
    // burst nor the server's wait_timeout leaves dead or surplus connections around.
    maxIdle: Math.max(0, Math.min(2, max - 1)),
    idleTimeout: idleMs,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
  });
  // Like pg's allowExitOnIdle: an idle pooled connection must not keep a CLI
  // process alive, but one that is running a query must.
  type WithStream = { stream?: { ref?: () => void; unref?: () => void } };
  pool.on("acquire", (conn) => (conn as unknown as WithStream).stream?.ref?.());
  pool.on("release", (conn) => (conn as unknown as WithStream).stream?.unref?.());
  pool.on("connection", (conn) => {
    conn.on("error", () => {});
  });
  return new Kysely<Schema>({
    dialect: traceDialect(
      new MysqlDialect({
        pool,
        onCreateConnection: async (connection) => {
          // Index every word: MySQL's default full-text stop-word list would make
          // searches for words like "about" or "world" find nothing (FTS5 has no such list).
          await connection.executeQuery(
            CompiledQuery.raw("SET SESSION innodb_ft_enable_stopword = OFF"),
          );
        },
      }),
      "mysql",
    ),
  });
}

async function migratePostgres(db: Kysely<Schema>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // Serialise migrations across processes; released at commit.
    await sql`SELECT pg_advisory_xact_lock(${sql.lit(0x77666d67)})`.execute(trx);
    await sql`CREATE TABLE IF NOT EXISTS webfrost_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`.execute(
      trx,
    );
    const current =
      (await sql<{ v: number | null }>`SELECT MAX(version) AS v FROM webfrost_schema`.execute(trx))
        .rows[0]?.v ?? 0;
    for (const step of POSTGRES_MIGRATIONS) {
      if (step.version <= current) continue;
      for (const statement of step.statements) await sql.raw(statement).execute(trx);
      await sql`INSERT INTO webfrost_schema (version, applied_at) VALUES (${step.version}, ${new Date().toISOString()})`.execute(
        trx,
      );
    }
  });
}

/** MySQL's answer to adding a column or an index that exists: 1060 ER_DUP_FIELDNAME, 1061 ER_DUP_KEYNAME. */
export function isAlreadyApplied(err: unknown): boolean {
  const e = err as { errno?: number; code?: string } | null;
  return (
    e?.errno === 1060 ||
    e?.errno === 1061 ||
    e?.code === "ER_DUP_FIELDNAME" ||
    e?.code === "ER_DUP_KEYNAME"
  );
}

async function migrateMysql(db: Kysely<Schema>): Promise<void> {
  // DDL is not transactional on MySQL: a named lock serialises processes, and an interrupted step
  // runs again. MySQL 8 has no IF NOT EXISTS for ADD COLUMN or CREATE INDEX, so a column or an
  // index the interrupted run already made (ER_DUP_FIELDNAME, ER_DUP_KEYNAME) counts as applied.
  await db.connection().execute(async (conn) => {
    const lock = sql`CONCAT('webfrost_migrate:', DATABASE())`;
    const got = await sql<{ l: number | null }>`SELECT GET_LOCK(${lock}, 120) AS l`.execute(conn);
    if (got.rows[0]?.l !== 1) throw new Error("timed out waiting for the schema migration lock");
    try {
      await sql`CREATE TABLE IF NOT EXISTS webfrost_schema (version INT NOT NULL PRIMARY KEY, applied_at VARCHAR(32) NOT NULL) ENGINE=InnoDB`.execute(
        conn,
      );
      const current =
        (
          await sql<{ v: number | null }>`SELECT MAX(version) AS v FROM webfrost_schema`.execute(
            conn,
          )
        ).rows[0]?.v ?? 0;
      for (const step of MYSQL_MIGRATIONS) {
        if (step.version <= current) continue;
        for (const statement of step.statements) {
          try {
            await sql.raw(statement).execute(conn);
          } catch (err) {
            if (!isAlreadyApplied(err)) throw err;
          }
        }
        await sql`INSERT INTO webfrost_schema (version, applied_at) VALUES (${step.version}, ${new Date().toISOString()})`.execute(
          conn,
        );
      }
    } finally {
      await sql`SELECT RELEASE_LOCK(${lock})`.execute(conn);
    }
  });
}

const createdTestDatabases = new Set<string>();

/** WEBFROST_TEST_DATABASE_URL: create the per-directory schema (PostgreSQL) or database (MySQL). */
async function ensureTestDatabase(dir: string, dialect: "postgres" | "mysql"): Promise<void> {
  const base = process.env.WEBFROST_TEST_DATABASE_URL;
  if (!base) return;
  const name = testDatabaseName(dir);
  if (createdTestDatabases.has(name)) return;
  const config = parseDatabaseUrl(base, dir);
  if (config.dialect === "postgres" && dialect === "postgres") {
    const pg = (await import("pg")).default;
    const client = new pg.Client({ connectionString: config.url });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
    } catch (err) {
      // Two processes creating it at once: one of them loses the race, harmlessly.
      if (!isUniqueViolation(err) && (err as DriverError).code !== "42P06") throw err;
    } finally {
      await client.end();
    }
  } else if (config.dialect === "mysql" && dialect === "mysql") {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({ uri: config.url });
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4`);
    } finally {
      await conn.end();
    }
  }
  createdTestDatabases.add(name);
}

function serverDatabase(config: Extract<DatabaseConfig, { url: string }>): Promise<Kysely<Schema>> {
  const key = databaseKey(config);
  let entry = serverDatabases.get(key);
  if (!entry) {
    const pending = (async () => {
      const kysely = await (config.dialect === "postgres" ? createPostgres : createMysql)(
        config.url,
      );
      try {
        await (config.dialect === "postgres" ? migratePostgres : migrateMysql)(kysely);
      } catch (err) {
        await kysely.destroy().catch(() => {});
        throw err;
      }
      return kysely;
    })();
    entry = pending;
    // A failed connection or migration is retried by the next openDb().
    pending.catch(() => {
      if (serverDatabases.get(key) === pending) serverDatabases.delete(key);
    });
    serverDatabases.set(key, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the archive database for `dir` — see `resolveDatabaseConfig` for how the
 * engine is chosen (DATABASE_URL, else SQLite at `<dir>/archive.db`). Applies
 * pending schema migrations the first time.
 */
export async function openDb(dir: string): Promise<Db> {
  const config = resolveDatabaseConfig(dir);
  const key = databaseKey(config);
  if (config.dialect === "sqlite") {
    const { kysely, release } = await acquireSqlite(config.path);
    return new KyselyDb("sqlite", key, kysely, release);
  }
  if (process.env.WEBFROST_TEST_DATABASE_URL) await ensureTestDatabase(dir, config.dialect);
  const kysely = await serverDatabase(config);
  return new KyselyDb(config.dialect, key, kysely, async () => {});
}

/** The `Db.key` that `openDb(dir)` would return, without opening anything. */
export function databaseKeyFor(dir: string): string {
  return databaseKey(resolveDatabaseConfig(dir));
}

/**
 * End every PostgreSQL/MySQL pool this process opened. Call it once at shutdown,
 * after the last query (the server does, after draining archive jobs). SQLite
 * handles are closed individually by `Db.close()`.
 */
export async function closeDatabases(): Promise<void> {
  const entries = [...serverDatabases.values()];
  serverDatabases.clear();
  await Promise.all(
    entries.map(async (entry) => {
      const kysely = await entry.catch(() => undefined);
      await kysely?.destroy();
    }),
  );
}
