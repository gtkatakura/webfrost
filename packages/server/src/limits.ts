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

const DEFAULT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_IMPORT_MAX_URLS = 10_000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** WEBFROST_IMPORT_MAX_BYTES: largest import file or `content` body (default 10 MiB). */
export function importMaxBytes(): number {
  return positiveIntEnv("WEBFROST_IMPORT_MAX_BYTES", DEFAULT_IMPORT_MAX_BYTES);
}

/** WEBFROST_IMPORT_MAX_URLS: most URLs a single import may queue (default 10000). */
export function importMaxUrls(): number {
  return positiveIntEnv("WEBFROST_IMPORT_MAX_URLS", DEFAULT_IMPORT_MAX_URLS);
}

/**
 * Largest request body the server reads at all. Imports are the only large bodies;
 * the slack covers JSON escaping and multipart framing around the import payload.
 */
export function maxRequestBodyBytes(): number {
  return importMaxBytes() * 2 + 1024 * 1024;
}
