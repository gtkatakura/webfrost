import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminUser, createApiKey, createSession, hasAdminUser } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getSessionSecret, setSessionCookie } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from "../limits";
import { isPublicRead } from "./auth";

/**
 * WEBFROST_SETUP_TOKEN: when set, first-run setup must present it, so a fresh
 * instance reachable from the network cannot be claimed by whoever finds it first.
 */
export function setupToken(): string | null {
  return process.env.WEBFROST_SETUP_TOKEN || null;
}

/** Header that carries the setup token (the body field `setupToken` works too). */
export const SETUP_TOKEN_HEADER = "x-setup-token";

function tokensMatch(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time whatever their lengths.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export const setupRouter = new Elysia({ prefix: "/setup" })
  .onError(apiErrorHandler)
  .get("/status", () => {
    // AUTH_DISABLED bypasses setup so E2E tests can run without seeding an admin user
    // publicRead tells the UI whether anonymous visitors get a read-only view;
    // setupTokenRequired whether the setup form must ask for WEBFROST_SETUP_TOKEN.
    const setupTokenRequired = setupToken() !== null;
    if (process.env.AUTH_DISABLED === "true") {
      return { needsSetup: false, publicRead: isPublicRead(), setupTokenRequired };
    }
    const db = getDb();
    try {
      return { needsSetup: !hasAdminUser(db), publicRead: isPublicRead(), setupTokenRequired };
    } finally {
      db.close();
    }
  })
  .post(
    "/",
    async ({ body, set, cookie, request }) => {
      const expectedToken = setupToken();
      if (expectedToken !== null) {
        const given = request.headers.get(SETUP_TOKEN_HEADER) ?? body.setupToken ?? "";
        if (!tokensMatch(given, expectedToken)) {
          set.status = 403;
          return { error: "invalid setup token", code: "SETUP_TOKEN_INVALID" };
        }
      }

      // Check the secret before creating anything: failing afterwards would leave an
      // admin user behind with no way to finish (or repeat) the setup.
      let secret: string;
      try {
        secret = getSessionSecret();
      } catch {
        set.status = 500;
        return { error: "server misconfigured" };
      }

      const db = getDb();
      try {
        if (hasAdminUser(db)) {
          set.status = 409;
          return { error: "setup already complete" };
        }

        try {
          await createAdminUser(db, body.username, body.password);
        } catch {
          // Lost a race with another setup request: the admin exists now.
          set.status = 409;
          return { error: "setup already complete" };
        }
        const { rawKey } = createApiKey(db, "default");
        setSessionCookie(cookie.session, createSession(db, secret, body.username));

        return { apiKey: rawKey };
      } finally {
        db.close();
      }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1, maxLength: MAX_USERNAME_LENGTH }),
        password: t.String({ minLength: 8, maxLength: MAX_PASSWORD_LENGTH }),
        setupToken: t.Optional(t.String({ maxLength: 1024 })),
      }),
    },
  );
