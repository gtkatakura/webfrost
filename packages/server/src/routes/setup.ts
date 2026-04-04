import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAdminUser,
  createApiKey,
  createSessionToken,
  hasAdminUser,
  openDb,
} from "@webfrost/core";
import { Elysia, t } from "elysia";

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

export const setupRouter = new Elysia({ prefix: "/setup" })
  .get("/status", () => {
    const db = getDb();
    try {
      return { needsSetup: !hasAdminUser(db) };
    } finally {
      db.close();
    }
  })
  .post(
    "/",
    async ({ body, set, cookie }) => {
      const db = getDb();
      try {
        if (hasAdminUser(db)) {
          set.status = 409;
          return { error: "setup already complete" };
        }

        await createAdminUser(db, body.username, body.password);
        const { rawKey } = createApiKey(db, "default");

        let secret: string;
        try {
          secret = getSessionSecret();
        } catch {
          set.status = 500;
          return { error: "server misconfigured" };
        }

        const token = createSessionToken(secret, body.username);
        const isSecure = process.env.NODE_ENV !== "development";
        const sessionCookie = cookie.session;
        if (sessionCookie) {
          sessionCookie.value = token;
          sessionCookie.httpOnly = true;
          sessionCookie.sameSite = "strict";
          sessionCookie.path = "/";
          if (isSecure) sessionCookie.secure = true;
        }

        return { apiKey: rawKey };
      } finally {
        db.close();
      }
    },
    { body: t.Object({ username: t.String(), password: t.String() }) },
  );
