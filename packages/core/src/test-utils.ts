/**
 * Helpers for test suites that run against every supported database.
 *
 * `bun test` uses SQLite (a fresh `archive.db` per temp directory), exactly as
 * before. Set WEBFROST_TEST_DATABASE_URL to a PostgreSQL or MySQL server to run
 * the same suites there: `openDb(dir)` then maps every directory to its own
 * schema (PostgreSQL) or database (MySQL), created on first use, so each test
 * still starts from an empty archive — in child processes too.
 *
 *   WEBFROST_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/webfrost bun test
 *   WEBFROST_TEST_DATABASE_URL=mysql://root:pass@localhost:3306/webfrost bun test
 *
 * The MySQL server needs `--innodb-ft-min-token-size=1` for the search tests
 * (MySQL does not index words shorter than that setting; the default is 3).
 */
import { parseDatabaseUrl } from "./database/config";
import type { DialectName } from "./database/config";

/** The dialect the current test run targets. */
export function testDialect(): DialectName {
  const url = process.env.WEBFROST_TEST_DATABASE_URL?.trim();
  if (!url || url === "sqlite") return "sqlite";
  return parseDatabaseUrl(url, process.cwd()).dialect;
}

/** True when the run targets SQLite — for tests of SQLite-only behaviour (PRAGMAs, FTS5 syntax, the archive file). */
export const isSqliteRun = testDialect() === "sqlite";
