import { isAbsolute, join, resolve } from "node:path";

export type DialectName = "sqlite" | "postgres" | "mysql";

export type DatabaseConfig =
  | { dialect: "sqlite"; path: string }
  | { dialect: "postgres"; url: string }
  | { dialect: "mysql"; url: string };

/**
 * Parse a `DATABASE_URL` value.
 *
 * - `postgres://…` / `postgresql://…` → PostgreSQL
 * - `mysql://…` → MySQL
 * - `sqlite:///abs/path.db`, `sqlite://relative.db`, `file:path.db` or a bare
 *   file path → SQLite at that path (relative paths resolve against the
 *   archive directory, so `DATABASE_URL=archive.db` is the default layout).
 */
export function parseDatabaseUrl(value: string, dir: string): DatabaseConfig {
  const raw = value.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return { dialect: "postgres", url: raw };
  if (scheme === "mysql") return { dialect: "mysql", url: raw };
  if (scheme === "sqlite" || scheme === "file") {
    const rest = raw.slice(scheme.length + 1).replace(/^\/\//, "");
    if (!rest) throw new Error(`DATABASE_URL has no file path: ${value}`);
    return { dialect: "sqlite", path: sqlitePath(decodeURIComponent(rest), dir) };
  }
  // A Windows drive letter ("C:\…") parses as a scheme; anything else is unsupported.
  if (scheme && scheme.length > 1) {
    throw new Error(
      `Unsupported DATABASE_URL scheme "${scheme}:" (use postgres://, mysql:// or sqlite://)`,
    );
  }
  return { dialect: "sqlite", path: sqlitePath(raw, dir) };
}

function sqlitePath(path: string, dir: string): string {
  return isAbsolute(path) ? path : resolve(dir, path);
}

/**
 * Which database an archive directory uses:
 *
 * 1. `WEBFROST_TEST_DATABASE_URL` (test suites only — see `testDatabaseConfig`);
 * 2. `DATABASE_URL`;
 * 3. SQLite at `<dir>/archive.db` (the default, unchanged since the first release).
 *
 * Archive files (screenshots, WARCs, …) always go to the storage backend
 * (`WEBFROST_DIR` or S3), whichever database holds the metadata.
 */
export function resolveDatabaseConfig(
  dir: string,
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const test = env.WEBFROST_TEST_DATABASE_URL?.trim();
  if (test && test !== "sqlite") return testDatabaseConfig(test, dir);
  const url = env.DATABASE_URL?.trim();
  if (url) return parseDatabaseUrl(url, dir);
  return { dialect: "sqlite", path: join(dir, "archive.db") };
}

/** Identifier of the throwaway schema/database a test archive directory maps to. */
export function testDatabaseName(dir: string): string {
  return `wft_${Bun.hash(resolve(dir)).toString(36)}`;
}

/**
 * Test isolation: every archive directory gets its own PostgreSQL schema or MySQL
 * database on the server `WEBFROST_TEST_DATABASE_URL` points at, so suites written
 * for "one temp dir = one fresh archive" run unchanged — child processes included,
 * since the mapping only depends on the directory path.
 */
function testDatabaseConfig(url: string, dir: string): DatabaseConfig {
  const base = parseDatabaseUrl(url, dir);
  if (base.dialect === "sqlite") return { dialect: "sqlite", path: join(dir, "archive.db") };
  const name = testDatabaseName(dir);
  const u = new URL(base.url);
  if (base.dialect === "postgres") {
    u.searchParams.set("options", `-c search_path=${name}`);
    return { dialect: "postgres", url: u.toString() };
  }
  u.pathname = `/${name}`;
  return { dialect: "mysql", url: u.toString() };
}

/** Stable identity of a database, for per-process caches. Never contains a password. */
export function databaseKey(config: DatabaseConfig): string {
  if (config.dialect === "sqlite") return `sqlite:${config.path}`;
  const u = new URL(config.url);
  u.password = "";
  return `${config.dialect}:${u.toString()}`;
}
