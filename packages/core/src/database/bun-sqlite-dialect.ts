import type Database from "bun:sqlite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

/**
 * Kysely dialect for `bun:sqlite`.
 *
 * Kysely ships a SQLite dialect for better-sqlite3 only. This one wraps a single,
 * already-open `bun:sqlite` connection (pragmas and migrations are applied by
 * `openSqlite` before it is handed over). Kysely serialises access to it — SQLite
 * adapters declare a single connection — so a transaction never interleaves with
 * other queries on the same handle.
 *
 * Transactions start with `BEGIN IMMEDIATE`: they take the write lock up front, so
 * two processes cannot both read inside a deferred transaction and then deadlock
 * when they upgrade to a write (SQLite reports that as SQLITE_BUSY without waiting
 * for busy_timeout). That is what `db.transaction(...).immediate()` used to do.
 */
export class BunSqliteDialect implements Dialect {
  constructor(private readonly database: Database) {}

  createDriver(): Driver {
    return new BunSqliteDriver(this.database);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  // biome-ignore lint/suspicious/noExplicitAny: Kysely's introspector takes any schema.
  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class BunSqliteDriver implements Driver {
  private readonly connection: BunSqliteConnection;

  constructor(private readonly database: Database) {
    this.connection = new BunSqliteConnection(database);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN IMMEDIATE"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    this.database.close();
  }
}

type Binding = string | number | bigint | boolean | null | Uint8Array;

class BunSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const params = compiledQuery.parameters as Binding[];
    // query() caches the prepared statement on the connection.
    const stmt = this.database.query<R, Binding[]>(compiledQuery.sql);
    if (stmt.columnNames.length > 0) {
      return { rows: stmt.all(...params) };
    }
    const { changes, lastInsertRowid } = stmt.run(...params);
    return {
      rows: [],
      numAffectedRows: BigInt(changes),
      insertId: BigInt(lastInsertRowid),
    };
  }

  // biome-ignore lint/correctness/useYield: streaming is not used; Kysely requires the method.
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("streaming is not supported by the bun:sqlite dialect");
  }
}
