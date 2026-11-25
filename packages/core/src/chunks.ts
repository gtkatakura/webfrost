/**
 * Ids in groups small enough for one `IN (...)` each: a selection of thousands must not make a
 * statement with thousands of parameters (SQLite allows 32,766, PostgreSQL 65,535, and long lists
 * plan badly everywhere).
 */
export const ID_CHUNK = 500;

export function* chunks<T>(items: readonly T[], size = ID_CHUNK): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
