import {
  createSession,
  getAdminUsername,
  revokeSession,
  updateAdminPassword,
  validateAdminCredentials,
  validateApiKey,
  verifySession,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import {
  clearSessionCookie,
  getDb,
  getSessionSecret,
  parseCookie,
  setSessionCookie,
} from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from "../limits";
import { logger } from "../logger";

/** WEBFROST_PUBLIC_READ=true lets anonymous visitors browse the archive (never change it). */
export function isPublicRead(): boolean {
  return process.env.WEBFROST_PUBLIC_READ === "true";
}

/**
 * The only routes an anonymous visitor may call when public read is on: listing,
 * searching and viewing snapshots, their tags and files, and the stats card.
 * Everything else — every write, schedules, imports, settings, API keys — stays
 * private. The prefix is optional (routers mounted standalone in tests), and both the v1
 * prefix and the deprecated bare /api alias are covered.
 */
const PUBLIC_READ_ROUTES = [
  /^(?:\/api(?:\/v1)?)?\/snapshots\/?$/,
  /^(?:\/api(?:\/v1)?)?\/snapshots\/\d+\/?$/,
  /^(?:\/api(?:\/v1)?)?\/snapshots\/\d+\/tags\/?$/,
  /^(?:\/api(?:\/v1)?)?\/snapshots\/\d+\/archives\/[a-z-]+\/(?:download|preview)$/,
  /^(?:\/api(?:\/v1)?)?\/tags\/?$/,
  /^(?:\/api(?:\/v1)?)?\/stats\/?$/,
];

// Routes that never require credentials (the /api prefix is optional for the same reason).
const LOGIN_ROUTE = /^(?:\/api(?:\/v1)?)?\/auth\/login\/?$/;
// Logout must work with an expired or revoked session too, or the browser keeps a
// dead cookie it cannot get rid of.
const LOGOUT_ROUTE = /^(?:\/api(?:\/v1)?)?\/auth\/logout\/?$/;
const SETUP_STATUS_ROUTE = /^(?:\/api(?:\/v1)?)?\/setup\/status\/?$/;
const SETUP_ROUTE = /^(?:\/api(?:\/v1)?)?\/setup\/?$/;

// Requests let through as anonymous guests, so routes can hold back details
// (such as storage paths) that only the admin should see.
const guestRequests = new WeakSet<Request>();

/** True when the request was admitted by public read rather than by credentials. */
export function isGuestRequest(request: Request): boolean {
  return guestRequests.has(request);
}

/**
 * Elysia plugin that adds Bearer + session auth to every route inside /api.
 * - AUTH_DISABLED=true bypasses all checks (dev only).
 * - Bearer token → validated against api_keys table.
 * - session cookie → HMAC signature verified with SESSION_SECRET, then looked up
 *   in the sessions table so logout and password changes take effect immediately.
 * - WEBFROST_PUBLIC_READ=true additionally admits anonymous GETs on the read-only
 *   routes listed above.
 */
let warnedAuthDisabled = false;

export function authPlugin(app: Elysia) {
  const authDisabled = process.env.AUTH_DISABLED === "true";

  if (authDisabled) {
    // Once per process: the plugin is mounted on /api/v1 and on the deprecated /api alias.
    if (!warnedAuthDisabled) {
      warnedAuthDisabled = true;
      logger.warn("AUTH_DISABLED=true — all auth checks bypassed (dev mode only)");
    }
    return app;
  }

  return app.onBeforeHandle(async ({ request, set }) => {
    // Public endpoints — allow unauthenticated access. Matched exactly: a suffix
    // match would also wave through any future route that merely ends the same way.
    const url = new URL(request.url);
    if (request.method === "POST" && LOGIN_ROUTE.test(url.pathname)) return;
    if (request.method === "POST" && LOGOUT_ROUTE.test(url.pathname)) return;
    if (request.method === "GET" && SETUP_STATUS_ROUTE.test(url.pathname)) return;
    if (request.method === "POST" && SETUP_ROUTE.test(url.pathname)) return;

    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const sessionToken = parseCookie(request.headers.get("cookie"), "session");

    if (bearer || sessionToken) {
      const db = await getDb();
      try {
        if (bearer && (await validateApiKey(db, bearer))) return;
        if (sessionToken) {
          let secret: string | null = null;
          try {
            secret = getSessionSecret();
          } catch {
            // SESSION_SECRET missing — treat as no valid session
          }
          if (secret && (await verifySession(db, secret, sessionToken))) return;
        }
      } finally {
        await db.close();
      }
    }

    if (
      isPublicRead() &&
      (request.method === "GET" || request.method === "HEAD") &&
      PUBLIC_READ_ROUTES.some((route) => route.test(url.pathname))
    ) {
      guestRequests.add(request);
      return;
    }

    return apiError(set, 401, "UNAUTHORIZED", "unauthorized");
  });
}

/** Delete the server-side session behind a cookie value, if it is one of ours. */
async function revokeCookieSession(request: Request): Promise<void> {
  const sessionToken = parseCookie(request.headers.get("cookie"), "session");
  const secret = process.env.SESSION_SECRET;
  if (!sessionToken || !secret) return;
  const db = await getDb();
  try {
    await revokeSession(db, secret, sessionToken);
  } finally {
    await db.close();
  }
}

const passwordField = () => t.String({ maxLength: MAX_PASSWORD_LENGTH });

export const authRouter = new Elysia({ prefix: "/auth" })
  .onError(apiErrorHandler)
  .post(
    "/login",
    async ({ body, set, cookie, request }) => {
      const { username, password } = body;

      let secret: string;
      try {
        secret = getSessionSecret();
      } catch {
        return apiError(set, 500, "INTERNAL", "server misconfigured");
      }

      const db = await getDb();
      try {
        const validUsername = await validateAdminCredentials(db, username, password);
        if (!validUsername) {
          return apiError(set, 401, "INVALID_CREDENTIALS", "invalid credentials");
        }
        // The session this cookie replaces must not stay valid in a copy of the old one.
        await revokeCookieSession(request);
        setSessionCookie(cookie.session, await createSession(db, secret, validUsername));
        return { ok: true };
      } finally {
        await db.close();
      }
    },
    {
      body: t.Object({
        username: t.String({ maxLength: MAX_USERNAME_LENGTH }),
        password: passwordField(),
      }),
    },
  )
  .post("/logout", async ({ request, cookie, set }) => {
    // Remove the server-side session so the cookie is dead even if a copy survives.
    // Public route: an expired or revoked session still gets its cookie cleared.
    await revokeCookieSession(request);
    clearSessionCookie(cookie.session);
    set.status = 204;
    return null;
  })
  .get("/me", async ({ request }) => {
    const authDisabled = process.env.AUTH_DISABLED === "true";
    if (authDisabled) return { username: "admin" };

    // Extract username from the session (the request was already authenticated by the plugin)
    const sessionToken = parseCookie(request.headers.get("cookie"), "session");
    if (sessionToken && process.env.SESSION_SECRET) {
      const db = await getDb();
      try {
        const username = await verifySession(db, process.env.SESSION_SECRET, sessionToken);
        if (username) return { username };
      } finally {
        await db.close();
      }
    }
    // API key auth — username not available from key alone
    return { username: null };
  })
  .post(
    "/change-password",
    async ({ body, set, cookie, request }) => {
      const { currentPassword, newPassword } = body;

      if (newPassword.length < 8) {
        return apiError(set, 400, "VALIDATION", "New password must be at least 8 characters");
      }

      const db = await getDb();
      try {
        const username = await getAdminUsername(db);
        if (!username) {
          return apiError(set, 404, "NOT_FOUND", "No admin user found");
        }

        const valid = await validateAdminCredentials(db, username, currentPassword);
        if (!valid) {
          // 403, not 401: the caller is authenticated, it is the supplied password that is wrong.
          // Clients treat 401 as "session expired" and would log the user out.
          return apiError(set, 403, "INVALID_CREDENTIALS", "Current password is incorrect");
        }

        // Revokes every session for this user, including the caller's…
        await updateAdminPassword(db, username, newPassword);

        // …so hand the caller a fresh one when they are logged in through the browser.
        const hadSession = parseCookie(request.headers.get("cookie"), "session") !== null;
        if (hadSession && process.env.SESSION_SECRET) {
          setSessionCookie(
            cookie.session,
            await createSession(db, process.env.SESSION_SECRET, username),
          );
        }
        return { ok: true };
      } finally {
        await db.close();
      }
    },
    { body: t.Object({ currentPassword: passwordField(), newPassword: passwordField() }) },
  );
