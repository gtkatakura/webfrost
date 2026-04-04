import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSessionToken,
  getAdminUsername,
  openDb,
  updateAdminPassword,
  validateAdminCredentials,
  validateApiKey,
  verifySessionToken,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { logger } from "../logger";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var not set");
  return secret;
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k?.trim() === name && v) return decodeURIComponent(v.trim());
  }
  return null;
}

/**
 * Elysia plugin that adds Bearer + session auth to every route inside /api.
 * - AUTH_DISABLED=true bypasses all checks (dev only).
 * - Bearer token → validated against api_keys table.
 * - session cookie → verified with SESSION_SECRET HMAC signature.
 */
export function authPlugin(app: Elysia) {
  const authDisabled = process.env.AUTH_DISABLED === "true";

  if (authDisabled) {
    logger.warn("AUTH_DISABLED=true — all auth checks bypassed (dev mode only)");
    return app;
  }

  return app.onBeforeHandle(({ request, set }) => {
    // Public endpoints — allow unauthenticated access
    const url = new URL(request.url);
    if (url.pathname.endsWith("/auth/login") && request.method === "POST") return;
    if (url.pathname.endsWith("/setup/status") && request.method === "GET") return;
    if (
      (url.pathname.endsWith("/setup") || url.pathname.endsWith("/setup/")) &&
      request.method === "POST"
    )
      return;
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const rawKey = authHeader.slice(7);
      const db = getDb();
      let valid = false;
      try {
        valid = validateApiKey(db, rawKey);
      } finally {
        db.close();
      }
      if (valid) return;
    }

    const cookieHeader = request.headers.get("cookie");
    const sessionToken = parseCookie(cookieHeader, "session");
    if (sessionToken) {
      let secret: string;
      try {
        secret = getSessionSecret();
      } catch {
        // SESSION_SECRET missing — treat as no valid session
        set.status = 401;
        return { error: "unauthorized" };
      }
      const username = verifySessionToken(secret, sessionToken);
      if (username) return;
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
      let validUsername: string | null = null;
      try {
        validUsername = await validateAdminCredentials(db, username, password);
      } finally {
        db.close();
      }

      if (!validUsername) {
        set.status = 401;
        return { error: "invalid credentials" };
      }

      const token = createSessionToken(secret, validUsername);
      const isSecure = process.env.NODE_ENV !== "development";

      const sessionCookie = cookie.session;
      if (sessionCookie) {
        sessionCookie.value = token;
        sessionCookie.httpOnly = true;
        sessionCookie.sameSite = "strict";
        sessionCookie.path = "/";
        if (isSecure) sessionCookie.secure = true;
      }

      return { ok: true };
    },
    { body: t.Object({ username: t.String(), password: t.String() }) },
  )
  .post("/logout", ({ cookie }) => {
    cookie.session?.remove();
    return { ok: true };
  })
  .get("/me", ({ request }) => {
    const authDisabled = process.env.AUTH_DISABLED === "true";
    if (authDisabled) return { username: "admin" };

    // Extract username from Bearer or session (already validated by middleware)
    const cookieHeader = request.headers.get("cookie");
    const sessionToken = parseCookie(cookieHeader, "session");
    if (sessionToken) {
      let secret: string;
      try {
        secret = getSessionSecret();
      } catch {
        return { username: null };
      }
      const username = verifySessionToken(secret, sessionToken);
      if (username) return { username };
    }
    // API key auth — username not available from key alone
    return { username: null };
  })
  .post(
    "/change-password",
    async ({ body, set }) => {
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
          set.status = 401;
          return { error: "Current password is incorrect" };
        }

        await updateAdminPassword(db, username, newPassword);
        return { ok: true };
      } finally {
        db.close();
      }
    },
    { body: t.Object({ currentPassword: t.String(), newPassword: t.String() }) },
  );
