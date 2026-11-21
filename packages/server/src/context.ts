import { homedir } from "node:os";
import { join } from "node:path";
import { JobRunner, type StorageBackend, createStorageBackend, openDb } from "@webfrost/core";
import type { Cookie } from "elysia";
import pkg from "../package.json";
import { logger } from "./logger";

/** Server version, taken from package.json at build time. */
export const SERVER_VERSION: string = pkg.version;

export function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

export function getDb() {
  return openDb(getWebfrostDir());
}

export function getStorage(): StorageBackend {
  return createStorageBackend(getWebfrostDir());
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var not set");
  return secret;
}

// One runner per archive directory: every route that starts a pipeline shares it,
// so WEBFROST_CONCURRENCY bounds the whole process rather than each endpoint.
const runners = new Map<string, JobRunner>();

/** Background pipeline runner for the current WEBFROST_DIR. */
export function getRunner(): JobRunner {
  const dir = getWebfrostDir();
  let runner = runners.get(dir);
  if (!runner) {
    runner = new JobRunner({
      dir,
      logger: (snapshotId) => logger.child({ snapshotId }),
      storage: () => createStorageBackend(dir),
    });
    runners.set(dir, runner);
  }
  return runner;
}

/** Write the session cookie with the hardening flags every auth route must use. */
export function setSessionCookie(cookie: Cookie<unknown> | undefined, token: string): void {
  if (!cookie) return;
  cookie.value = token;
  cookie.httpOnly = true;
  cookie.sameSite = "strict";
  cookie.path = "/";
  // Browsers drop Secure cookies on plain-HTTP origins other than localhost, which
  // makes login silently fail on a LAN address. WEBFROST_INSECURE_COOKIES=true is the
  // explicit opt-out for deployments that really are HTTP-only.
  const insecure =
    process.env.NODE_ENV === "development" || process.env.WEBFROST_INSECURE_COOKIES === "true";
  if (!insecure) cookie.secure = true;
}

export function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
