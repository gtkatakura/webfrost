/**
 * The API's output conventions, applied at the HTTP boundary (the database keeps its own
 * formats): ISO 8601 UTC timestamps and one pagination envelope for every list.
 */
import { MAX_LIST_LIMIT } from "./limits";

/** Default page size of every list endpoint. */
export const DEFAULT_LIST_LIMIT = 20;

/**
 * A stored timestamp ("YYYY-MM-DD HH:MM:SS" UTC, the format every engine keeps) as ISO 8601
 * UTC with a `Z`, e.g. "2026-11-21T21:42:38Z". Values already in ISO form are normalised to
 * the same shape; null stays null.
 */
export function isoTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const stored = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]00:?00)?$/.exec(
    value,
  );
  if (stored) return `${stored[1]}T${stored[2]}Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 19)}Z`;
}

/** Same as {@link isoTimestamp} for a column that is never null. */
export function isoTimestampRequired(value: string): string {
  return isoTimestamp(value) ?? value;
}

/**
 * Parse an ISO 8601 timestamp from a request into the stored form ("YYYY-MM-DD HH:MM:SS" UTC).
 * A value without an offset is read as UTC. Returns null when it is not a valid timestamp.
 */
export function parseIsoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) && trimmed.length > 10;
  const date = new Date(hasOffset || trimmed.length === 10 ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** `page` and `limit` query parameters, shared by every list endpoint. */
export interface PageQuery {
  page?: string | undefined;
  limit?: string | undefined;
}

/**
 * The page a request asks for: whole numbers only (SQL rejects a fractional LIMIT/OFFSET),
 * page ≥ 1, and a limit between 1 and MAX_LIST_LIMIT for everyone, guests included.
 */
export function pageParams(query: PageQuery): { page: number; limit: number } {
  const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.trunc(Number(query.limit)) || DEFAULT_LIST_LIMIT),
  );
  return { page, limit };
}

/** The envelope every list endpoint returns. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** One page of a list that is already in memory. */
export function paginate<T>(all: readonly T[], query: PageQuery): Page<T> {
  const { page, limit } = pageParams(query);
  const start = (page - 1) * limit;
  return { items: all.slice(start, start + limit), total: all.length, page, limit };
}
