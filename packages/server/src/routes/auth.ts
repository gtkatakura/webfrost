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
import { getDb, getSessionSecret, parseCookie, setSessionCookie } from "../context";
import { logger } from "../logger";

/** WEBFROST_PUBLIC_READ=true lets anonymous visitors browse the archive (never change it). */
export function isPublicRead(): boolean {
  return process.env.WEBFROST_PUBLIC_READ === "true";
}

/**
 * The only routes an anonymous visitor may call when public read is on: listing,
 * searching and viewing snapshots, their tags and files, and the stats card.
 * Everything else — every write, schedules, imports, settings, API keys — stays
 * private. The optional /api prefix covers routers mounted standalone in tests.
 */
const PUBLIC_READ_ROUTES = [
  /^(?:\/api)?\/snapshots\/?$/,
  /^(?:\/api)?\/snapshots\/\d+\/?$/,
  /^(?:\/api)?\/snapshots\/\d+\/tags\/?$/,
  /^(?:\/api)?\/snapshots\/\d+\/archives\/[a-z-]+\/(?:download|preview)$/,
  /^(?:\/api)?\/tags\/?$/,
  /^(?:\/api)?\/stats\/?$/,
];

// Routes that never require credentials (the /api prefix is optional for the same reason).
const LOGIN_ROUTE = /^(?:\/api)?\/auth\/login\/?$/;
const SETUP_STATUS_ROUTE = /^(?:\/api)?\/setup\/status\/?$/;
const SETUP_ROUTE = /^(?:\/api)?\/setup\/?$/;

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
export function authPlugin(app: Elysia) {
  const authDisabled = process.env.AUTH_DISABLED === "true";

  if (authDisabled) {
    logger.warn("AUTH_DISABLED=true — all auth checks bypassed (dev mode only)");
    return app;
  }

  return app.onBeforeHandle(({ request, set }) => {
    // Public endpoints — allow unauthenticated access. Matched exactly: a suffix
    // match would also wave through any future route that merely ends the same way.
    const url = new URL(request.url);
    if (request.method === "POST" && LOGIN_ROUTE.test(url.pathname)) return;
    if (request.method === "GET" && SETUP_STATUS_ROUTE.test(url.pathname)) return;
    if (request.method === "POST" && SETUP_ROUTE.test(url.pathname)) return;

    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const sessionToken = parseCookie(request.headers.get("cookie"), "session");

    if (bearer || sessionToken) {
      const db = getDb();
      try {
        if (bearer && validateApiKey(db, bearer)) return;
        if (sessionToken) {
          let secret: string | null = null;
          try {
            secret = getSessionSecret();
          } catch {
            // SESSION_SECRET missing — treat as no valid session
          }
          if (secret && verifySession(db, secret, sessionToken)) return;
        }
      } finally {
        db.close();
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

    set.status = 401;
    return { error: "unauthorized" };
  });
}

export const authRouter = new Elysia({ prefix: "/auth" })
  .post(
    "/login",
    async ({ body, set, cookie }) => {
      const { username, password } = body;

      let secret: string;
      try {
        secret = getSessionSecret();
      } catch {
        set.status = 500;
        return { error: "server misconfigured" };
      }

      const db = getDb();
      try {
        const validUsername = await validateAdminCredentials(db, username, password);
        if (!validUsername) {
          set.status = 401;
          return { error: "invalid credentials" };
        }
        setSessionCookie(cookie.session, createSession(db, secret, validUsername));
        return { ok: true };
      } finally {
        db.close();
      }
    },
    { body: t.Object({ username: t.String(), password: t.String() }) },
  )
  .post("/logout", ({ request, cookie }) => {
    // Remove the server-side session so the cookie is dead even if a copy survives.
    const sessionToken = parseCookie(request.headers.get("cookie"), "session");
    if (sessionToken && process.env.SESSION_SECRET) {
      const db = getDb();
      try {
        revokeSession(db, process.env.SESSION_SECRET, sessionToken);
      } finally {
        db.close();
      }
    }
    cookie.session?.remove();
    return { ok: true };
  })
  .get("/me", ({ request }) => {
    const authDisabled = process.env.AUTH_DISABLED === "true";
    if (authDisabled) return { username: "admin" };

    // Extract username from the session (the request was already authenticated by the plugin)
    const sessionToken = parseCookie(request.headers.get("cookie"), "session");
    if (sessionToken && process.env.SESSION_SECRET) {
      const db = getDb();
      try {
        const username = verifySession(db, process.env.SESSION_SECRET, sessionToken);
        if (username) return { username };
      } finally {
        db.close();
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
        set.status = 400;
        return { error: "New password must be at least 8 characters" };
      }

      const db = getDb();
      try {
        const username = getAdminUsername(db);
        if (!username) {
          set.status = 404;
          return { error: "No admin user found" };
        }

        const valid = await validateAdminCredentials(db, username, currentPassword);
        if (!valid) {
          // 403, not 401: the caller is authenticated, it is the supplied password that is wrong.
          // Clients treat 401 as "session expired" and would log the user out.
          set.status = 403;
          return { error: "Current password is incorrect" };
        }

        // Revokes every session for this user, including the caller's…
        await updateAdminPassword(db, username, newPassword);

        // …so hand the caller a fresh one when they are logged in through the browser.
        const hadSession = parseCookie(request.headers.get("cookie"), "session") !== null;
        if (hadSession && process.env.SESSION_SECRET) {
          setSessionCookie(cookie.session, createSession(db, process.env.SESSION_SECRET, username));
        }
        return { ok: true };
      } finally {
        db.close();
      }
    },
    { body: t.Object({ currentPassword: t.String(), newPassword: t.String() }) },
  );
