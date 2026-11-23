/** Request size limits. Fixed limits are constants; the import limits are configurable. */

/** Longest password accepted anywhere (login, setup, change-password). */
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_USERNAME_LENGTH = 128;
export const MAX_API_KEY_NAME_LENGTH = 100;
export const MAX_TAG_NAME_LENGTH = 100;
export const MAX_TAG_COLOR_LENGTH = 32;
export const MAX_URL_LENGTH = 8192;
export const MAX_CRON_LENGTH = 256;
/** Largest page a list endpoint returns, whatever `limit` asks for. */
export const MAX_LIST_LIMIT = 200;

// The import limits live in core: the scheduler and the CLI hold feeds to the same ones.
import { importMaxBytes } from "@webfrost/core";

export { importMaxBytes, importMaxUrls } from "@webfrost/core";

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Largest body an ordinary API request may have. URL imports are the only large JSON or
 * multipart bodies; the slack covers JSON escaping and multipart framing around them.
 */
export function maxRequestBodyBytes(): number {
  return importMaxBytes() * 2 + 1024 * 1024;
}

const DEFAULT_IMPORT_BUNDLE_MAX_BYTES = 2 * 1024 ** 3;
/** Plain ZIP (no ZIP64) cannot describe more than 4 GiB. */
const MAX_IMPORT_BUNDLE_BYTES = 4 * 1024 ** 3 - 1;

/**
 * WEBFROST_IMPORT_BUNDLE_MAX_BYTES: largest snapshot bundle POST /snapshots/import accepts,
 * both as uploaded and once decompressed (default 2 GiB, at most 4 GiB - 1).
 */
export function importBundleMaxBytes(): number {
  return Math.min(
    positiveIntEnv("WEBFROST_IMPORT_BUNDLE_MAX_BYTES", DEFAULT_IMPORT_BUNDLE_MAX_BYTES),
    MAX_IMPORT_BUNDLE_BYTES,
  );
}

/**
 * The listener's body limit. The bundle import is the one route that takes a larger body
 * (streamed to disk); the request guard holds every other route to maxRequestBodyBytes().
 */
export function listenerMaxBodyBytes(): number {
  return Math.max(maxRequestBodyBytes(), importBundleMaxBytes());
}
