import { createAdminUser, createApiKey, createSession, hasAdminUser } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getSessionSecret, setSessionCookie } from "../context";
import { isPublicRead } from "./auth";

export const setupRouter = new Elysia({ prefix: "/setup" })
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "username is required and password must be at least 8 characters" };
    }
    return undefined;
  })
  .get("/status", () => {
    // AUTH_DISABLED bypasses setup so E2E tests can run without seeding an admin user
    // publicRead tells the UI whether anonymous visitors get a read-only view.
    if (process.env.AUTH_DISABLED === "true") {
      return { needsSetup: false, publicRead: isPublicRead() };
    }
    const db = getDb();
    try {
      return { needsSetup: !hasAdminUser(db), publicRead: isPublicRead() };
    } finally {
      db.close();
    }
  })
  .post(
    "/",
    async ({ body, set, cookie }) => {
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
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 8 }),
      }),
    },
  );
