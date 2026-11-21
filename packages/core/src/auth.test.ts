import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import {
  createAdminUser,
  createApiKey,
  createSession,
  createSessionToken,
  getAdminUsername,
  hasAdminUser,
  hashPassword,
  listApiKeys,
  revokeAllSessions,
  revokeApiKey,
  revokeSession,
  updateAdminPassword,
  validateAdminCredentials,
  validateApiKey,
  verifyPassword,
  verifySession,
  verifySessionToken,
} from "./auth";
import { type Db, openDb } from "./db";

let db: Db;
let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "webfrost-auth-test-"));
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe("hashPassword / verifyPassword", () => {
  test("round-trips correctly", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  test("rejects wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", hash)).toBe(false);
  });

  test("verifyPassword returns false for malformed hash", async () => {
    expect(await verifyPassword("password", "not-a-valid-hash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin user
// ---------------------------------------------------------------------------

describe("admin user", () => {
  test("hasAdminUser returns false on empty db", async () => {
    expect(await hasAdminUser(db)).toBe(false);
  });

  test("createAdminUser creates user and hasAdminUser returns true", async () => {
    await createAdminUser(db, "admin", "s3cr3t");
    expect(await hasAdminUser(db)).toBe(true);
  });

  test("getAdminUsername returns null when no user exists", async () => {
    expect(await getAdminUsername(db)).toBeNull();
  });

  test("getAdminUsername returns username after creation", async () => {
    await createAdminUser(db, "alice", "pass");
    expect(await getAdminUsername(db)).toBe("alice");
  });

  test("createAdminUser throws when user already exists", async () => {
    await createAdminUser(db, "admin", "pass1");
    expect(createAdminUser(db, "admin2", "pass2")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateAdminCredentials
// ---------------------------------------------------------------------------

describe("validateAdminCredentials", () => {
  beforeEach(async () => {
    await createAdminUser(db, "admin", "correct-pass");
  });

  test("returns username for valid credentials", async () => {
    const result = await validateAdminCredentials(db, "admin", "correct-pass");
    expect(result).toBe("admin");
  });

  test("returns null for wrong password", async () => {
    const result = await validateAdminCredentials(db, "admin", "wrong-pass");
    expect(result).toBeNull();
  });

  test("returns null for non-existent user", async () => {
    const result = await validateAdminCredentials(db, "unknown", "any-pass");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

describe("API keys", () => {
  test("createApiKey returns id and rawKey", async () => {
    const { id, rawKey } = await createApiKey(db, "test-key");
    expect(typeof id).toBe("string");
    expect(rawKey.length).toBeGreaterThan(0);
  });

  test("validateApiKey returns true for valid key", async () => {
    const { rawKey } = await createApiKey(db, "valid-key");
    expect(await validateApiKey(db, rawKey)).toBe(true);
  });

  test("validateApiKey returns false for unknown key", async () => {
    expect(await validateApiKey(db, "totally-unknown-key-that-does-not-exist")).toBe(false);
  });

  test("listApiKeys returns active keys", async () => {
    await createApiKey(db, "key-a");
    await createApiKey(db, "key-b");
    const keys = await listApiKeys(db);
    expect(keys.length).toBe(2);
    expect(keys.map((k) => k.name).sort()).toEqual(["key-a", "key-b"]);
  });

  test("revokeApiKey returns true and key no longer valid", async () => {
    const { id, rawKey } = await createApiKey(db, "to-revoke");
    expect(await revokeApiKey(db, id)).toBe(true);
    expect(await validateApiKey(db, rawKey)).toBe(false);
  });

  test("revokeApiKey returns false for non-existent id", async () => {
    expect(await revokeApiKey(db, "non-existent-id")).toBe(false);
  });

  test("revoked key does not appear in listApiKeys", async () => {
    const { id } = await createApiKey(db, "revoke-me");
    await createApiKey(db, "keep-me");
    await revokeApiKey(db, id);
    const keys = await listApiKeys(db);
    expect(keys.length).toBe(1);
    expect(keys[0]?.name).toBe("keep-me");
  });
});

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

describe("session tokens", () => {
  const SECRET = "super-secret-at-least-32-chars-long!!";

  test("creates and verifies a valid token", async () => {
    const token = createSessionToken(SECRET, "alice");
    expect(verifySessionToken(SECRET, token)).toBe("alice");
  });

  test("returns null for tampered token (corrupted signature)", async () => {
    const token = createSessionToken(SECRET, "alice");
    // Flip the last character of the signature
    const tampered = `${token.slice(0, -1)}x`;
    expect(verifySessionToken(SECRET, tampered)).toBeNull();
  });

  test("returns null for wrong secret", async () => {
    const token = createSessionToken(SECRET, "alice");
    expect(verifySessionToken("wrong-secret-32-chars-at-least!!!", token)).toBeNull();
  });

  test("returns null for malformed token (no dot)", async () => {
    expect(verifySessionToken(SECRET, "nodotinhere")).toBeNull();
  });

  test("returns null for empty token", async () => {
    expect(verifySessionToken(SECRET, "")).toBeNull();
  });

  test("returns null for expired token", async () => {
    // Manually craft a token with exp in the past
    const payload = Buffer.from(
      JSON.stringify({ u: "alice", iat: Date.now() - 10000, exp: Date.now() - 1000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    expect(verifySessionToken(SECRET, token)).toBeNull();
  });

  test("returns username for token with future exp", async () => {
    // Token with exp 1 hour from now
    const payload = Buffer.from(
      JSON.stringify({ u: "alice", iat: Date.now(), exp: Date.now() + 3_600_000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    expect(verifySessionToken(SECRET, token)).toBe("alice");
  });

  test("createSessionToken produces a token that expires ~7 days from now", async () => {
    const before = Date.now();
    const token = createSessionToken(SECRET, "bob");
    const after = Date.now();

    const payload = token.split(".").at(0) ?? "";
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      exp: number;
    };

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(data.exp).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(data.exp).toBeLessThanOrEqual(after + sevenDaysMs);
  });
});

// ---------------------------------------------------------------------------
// Server-side sessions (revocation)
// ---------------------------------------------------------------------------

describe("sessions", () => {
  const SESSION_SECRET = "test-secret-that-is-at-least-32-chars!!";

  test("createSession yields a cookie that verifySession accepts", async () => {
    const token = await createSession(db, SESSION_SECRET, "alice");
    expect(await verifySession(db, SESSION_SECRET, token)).toBe("alice");
  });

  test("a signed token with no server-side session is rejected", async () => {
    // Valid signature, valid expiry — but it was never registered, so it cannot be revoked
    // and therefore must not grant access.
    const token = createSessionToken(SESSION_SECRET, "alice");
    expect(verifySessionToken(SESSION_SECRET, token)).toBe("alice");
    expect(await verifySession(db, SESSION_SECRET, token)).toBeNull();
  });

  test("revokeSession (logout) kills that session only", async () => {
    const laptop = await createSession(db, SESSION_SECRET, "alice");
    const phone = await createSession(db, SESSION_SECRET, "alice");

    expect(await revokeSession(db, SESSION_SECRET, laptop)).toBe(true);

    expect(await verifySession(db, SESSION_SECRET, laptop)).toBeNull();
    expect(await verifySession(db, SESSION_SECRET, phone)).toBe("alice");
    expect(await revokeSession(db, SESSION_SECRET, laptop)).toBe(false);
  });

  test("changing the password revokes every session of that user", async () => {
    await createAdminUser(db, "alice", "old-password");
    const token = await createSession(db, SESSION_SECRET, "alice");

    await updateAdminPassword(db, "alice", "new-password");

    expect(await verifySession(db, SESSION_SECRET, token)).toBeNull();
    expect(await validateAdminCredentials(db, "alice", "new-password")).toBe("alice");
  });

  test("revokeAllSessions clears everything", async () => {
    const a = await createSession(db, SESSION_SECRET, "alice");
    const b = await createSession(db, SESSION_SECRET, "bob");
    expect(await revokeAllSessions(db)).toBe(2);
    expect(await verifySession(db, SESSION_SECRET, a)).toBeNull();
    expect(await verifySession(db, SESSION_SECRET, b)).toBeNull();
  });

  test("an expired session row is rejected and pruned on the next login", async () => {
    const token = await createSession(db, SESSION_SECRET, "alice");
    await db.run(sql`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'`);
    expect(await verifySession(db, SESSION_SECRET, token)).toBeNull();

    await createSession(db, SESSION_SECRET, "alice");
    expect((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM sessions`))?.n).toBe(1);
  });

  test("a token signed with another secret is rejected", async () => {
    const token = await createSession(db, SESSION_SECRET, "alice");
    expect(await verifySession(db, "another-secret-that-is-32-chars-long!!", token)).toBeNull();
  });
});

describe("hardening", () => {
  test("two concurrent setups create exactly one admin", async () => {
    const outcomes = await Promise.allSettled([
      createAdminUser(db, "alice", "password-one"),
      createAdminUser(db, "mallory", "password-two"),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM admin_users`))?.n).toBe(1);
  });

  test("an API key with an ISO expiry in the past is rejected the same day", async () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { rawKey } = await createApiKey(db, "expired", anHourAgo);
    expect(await validateApiKey(db, rawKey)).toBe(false);
  });

  test("an API key with an ISO expiry in the future is accepted", async () => {
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { rawKey } = await createApiKey(db, "valid", inAnHour);
    expect(await validateApiKey(db, rawKey)).toBe(true);
  });

  test("a date-only expiry is honoured", async () => {
    expect(await validateApiKey(db, (await createApiKey(db, "old", "2020-01-01")).rawKey)).toBe(
      false,
    );
    expect(await validateApiKey(db, (await createApiKey(db, "new", "2999-01-01")).rawKey)).toBe(
      true,
    );
  });

  test("an unparseable expiry never validates", async () => {
    const { rawKey } = await createApiKey(db, "garbage", "next tuesday");
    expect(await validateApiKey(db, rawKey)).toBe(false);
  });
});
