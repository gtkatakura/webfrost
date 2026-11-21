import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { openDb } from "./db";

let db: Database;
let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "webfrost-auth-test-"));
  db = openDb(testDir);
});

afterEach(async () => {
  db.close();
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
  test("hasAdminUser returns false on empty db", () => {
    expect(hasAdminUser(db)).toBe(false);
  });

  test("createAdminUser creates user and hasAdminUser returns true", async () => {
    await createAdminUser(db, "admin", "s3cr3t");
    expect(hasAdminUser(db)).toBe(true);
  });

  test("getAdminUsername returns null when no user exists", () => {
    expect(getAdminUsername(db)).toBeNull();
  });

  test("getAdminUsername returns username after creation", async () => {
    await createAdminUser(db, "alice", "pass");
    expect(getAdminUsername(db)).toBe("alice");
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
  test("createApiKey returns id and rawKey", () => {
    const { id, rawKey } = createApiKey(db, "test-key");
    expect(typeof id).toBe("string");
    expect(rawKey.length).toBeGreaterThan(0);
  });

  test("validateApiKey returns true for valid key", () => {
    const { rawKey } = createApiKey(db, "valid-key");
    expect(validateApiKey(db, rawKey)).toBe(true);
  });

  test("validateApiKey returns false for unknown key", () => {
    expect(validateApiKey(db, "totally-unknown-key-that-does-not-exist")).toBe(false);
  });

  test("listApiKeys returns active keys", () => {
    createApiKey(db, "key-a");
    createApiKey(db, "key-b");
    const keys = listApiKeys(db);
    expect(keys.length).toBe(2);
    expect(keys.map((k) => k.name).sort()).toEqual(["key-a", "key-b"]);
  });

  test("revokeApiKey returns true and key no longer valid", () => {
    const { id, rawKey } = createApiKey(db, "to-revoke");
    expect(revokeApiKey(db, id)).toBe(true);
    expect(validateApiKey(db, rawKey)).toBe(false);
  });

  test("revokeApiKey returns false for non-existent id", () => {
    expect(revokeApiKey(db, "non-existent-id")).toBe(false);
  });

  test("revoked key does not appear in listApiKeys", () => {
    const { id } = createApiKey(db, "revoke-me");
    createApiKey(db, "keep-me");
    revokeApiKey(db, id);
    const keys = listApiKeys(db);
    expect(keys.length).toBe(1);
    expect(keys[0]?.name).toBe("keep-me");
  });
});

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

describe("session tokens", () => {
  const SECRET = "super-secret-at-least-32-chars-long!!";

  test("creates and verifies a valid token", () => {
    const token = createSessionToken(SECRET, "alice");
    expect(verifySessionToken(SECRET, token)).toBe("alice");
  });

  test("returns null for tampered token (corrupted signature)", () => {
    const token = createSessionToken(SECRET, "alice");
    // Flip the last character of the signature
    const tampered = `${token.slice(0, -1)}x`;
    expect(verifySessionToken(SECRET, tampered)).toBeNull();
  });

  test("returns null for wrong secret", () => {
    const token = createSessionToken(SECRET, "alice");
    expect(verifySessionToken("wrong-secret-32-chars-at-least!!!", token)).toBeNull();
  });

  test("returns null for malformed token (no dot)", () => {
    expect(verifySessionToken(SECRET, "nodotinhere")).toBeNull();
  });

  test("returns null for empty token", () => {
    expect(verifySessionToken(SECRET, "")).toBeNull();
  });

  test("returns null for expired token", () => {
    // Manually craft a token with exp in the past
    const payload = Buffer.from(
      JSON.stringify({ u: "alice", iat: Date.now() - 10000, exp: Date.now() - 1000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    expect(verifySessionToken(SECRET, token)).toBeNull();
  });

  test("returns username for token with future exp", () => {
    // Token with exp 1 hour from now
    const payload = Buffer.from(
      JSON.stringify({ u: "alice", iat: Date.now(), exp: Date.now() + 3_600_000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    expect(verifySessionToken(SECRET, token)).toBe("alice");
  });

  test("createSessionToken produces a token that expires ~7 days from now", () => {
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

  test("createSession yields a cookie that verifySession accepts", () => {
    const token = createSession(db, SESSION_SECRET, "alice");
    expect(verifySession(db, SESSION_SECRET, token)).toBe("alice");
  });

  test("a signed token with no server-side session is rejected", () => {
    // Valid signature, valid expiry — but it was never registered, so it cannot be revoked
    // and therefore must not grant access.
    const token = createSessionToken(SESSION_SECRET, "alice");
    expect(verifySessionToken(SESSION_SECRET, token)).toBe("alice");
    expect(verifySession(db, SESSION_SECRET, token)).toBeNull();
  });

  test("revokeSession (logout) kills that session only", () => {
    const laptop = createSession(db, SESSION_SECRET, "alice");
    const phone = createSession(db, SESSION_SECRET, "alice");

    expect(revokeSession(db, SESSION_SECRET, laptop)).toBe(true);

    expect(verifySession(db, SESSION_SECRET, laptop)).toBeNull();
    expect(verifySession(db, SESSION_SECRET, phone)).toBe("alice");
    expect(revokeSession(db, SESSION_SECRET, laptop)).toBe(false);
  });

  test("changing the password revokes every session of that user", async () => {
    await createAdminUser(db, "alice", "old-password");
    const token = createSession(db, SESSION_SECRET, "alice");

    await updateAdminPassword(db, "alice", "new-password");

    expect(verifySession(db, SESSION_SECRET, token)).toBeNull();
    expect(await validateAdminCredentials(db, "alice", "new-password")).toBe("alice");
  });

  test("revokeAllSessions clears everything", () => {
    const a = createSession(db, SESSION_SECRET, "alice");
    const b = createSession(db, SESSION_SECRET, "bob");
    expect(revokeAllSessions(db)).toBe(2);
    expect(verifySession(db, SESSION_SECRET, a)).toBeNull();
    expect(verifySession(db, SESSION_SECRET, b)).toBeNull();
  });

  test("an expired session row is rejected and pruned on the next login", () => {
    const token = createSession(db, SESSION_SECRET, "alice");
    db.query("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect(verifySession(db, SESSION_SECRET, token)).toBeNull();

    createSession(db, SESSION_SECRET, "alice");
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(1);
  });

  test("a token signed with another secret is rejected", () => {
    const token = createSession(db, SESSION_SECRET, "alice");
    expect(verifySession(db, "another-secret-that-is-32-chars-long!!", token)).toBeNull();
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
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM admin_users").get()?.n).toBe(1);
  });

  test("an API key with an ISO expiry in the past is rejected the same day", () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { rawKey } = createApiKey(db, "expired", anHourAgo);
    expect(validateApiKey(db, rawKey)).toBe(false);
  });

  test("an API key with an ISO expiry in the future is accepted", () => {
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { rawKey } = createApiKey(db, "valid", inAnHour);
    expect(validateApiKey(db, rawKey)).toBe(true);
  });

  test("a date-only expiry is honoured", () => {
    expect(validateApiKey(db, createApiKey(db, "old", "2020-01-01").rawKey)).toBe(false);
    expect(validateApiKey(db, createApiKey(db, "new", "2999-01-01").rawKey)).toBe(true);
  });

  test("an unparseable expiry never validates", () => {
    const { rawKey } = createApiKey(db, "garbage", "next tuesday");
    expect(validateApiKey(db, rawKey)).toBe(false);
  });
});
