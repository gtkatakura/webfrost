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
/**
 * Let a request that works for a long time finish. Bun closes a connection that carries no data
 * for 10 seconds, and a bulk action (a DNS lookup per domain, thousands of snapshots deleted with
 * their files) sends nothing until it is done: cut off, the browser shows a network error while
 * the server carries on. Not served by Bun.serve (in-process tests) there is nothing to extend.
 */
export function allowLongRequest(
  server: { timeout(request: Request, seconds: number): void } | null | undefined,
  request: Request,
): void {
  try {
    server?.timeout(request, 0);
  } catch {
    // The request is not one of this server's.
  }
}

/**
 * A local hook for a router whose POST routes are bulk actions: each gets the time it needs.
 * `.onBeforeHandle(longPosts)`.
 */
export function longPosts({
  request,
  server,
}: {
  request: Request;
  server: { timeout(request: Request, seconds: number): void } | null;
}): void {
  if (request.method === "POST") allowLongRequest(server, request);
}

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
  if (!insecureCookies()) cookie.secure = true;
}

/** Expire the session cookie, with the same attributes it was set with. */
export function clearSessionCookie(cookie: Cookie<unknown> | undefined): void {
  if (!cookie) return;
  cookie.set({
    value: "",
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    ...(insecureCookies() ? {} : { secure: true }),
  });
}

function insecureCookies(): boolean {
  return process.env.NODE_ENV === "development" || process.env.WEBFROST_INSECURE_COOKIES === "true";
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
