/** Where version 1 of the HTTP API is mounted. Every route the API documents lives under it. */
export const API_PREFIX = "/api/v1";

/**
 * The unversioned prefix the API used before 0.1.0. It still serves the same routes as
 * API_PREFIX, with `Deprecation` and `Link: rel="successor-version"` headers, and goes
 * away in a later 0.x release.
 */
export const LEGACY_API_PREFIX = "/api";

/**
 * The v1 path a deprecated `/api/...` path stands for, or null when the path is not on the
 * deprecated alias (a v1 path, `/api` itself, or anything outside the API).
 */
export function successorPath(pathname: string): string | null {
  if (!pathname.startsWith(`${LEGACY_API_PREFIX}/`)) return null;
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return null;
  return `${API_PREFIX}${pathname.slice(LEGACY_API_PREFIX.length)}`;
}
