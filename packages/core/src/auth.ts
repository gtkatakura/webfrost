import type Database from "bun:sqlite";
import { createHash, createHmac, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Password hashing (bcrypt via Bun.password, min cost 10)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin user
// ---------------------------------------------------------------------------

export async function createAdminUser(
  db: Database,
  username: string,
  password: string,
): Promise<void> {
  const existing = db.query<{ id: number }, []>("SELECT id FROM admin_users LIMIT 1").get();
  if (existing) throw new Error("An admin user already exists");

  const hash = await hashPassword(password);
  // Hashing is slow and asynchronous, so two concurrent setups can both pass the
  // check above. The insert re-checks atomically: only one of them creates the admin.
  const result = db
    .query<null, [string, string]>(
      "INSERT INTO admin_users (username, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users)",
    )
    .run(username, hash);
  if (result.changes === 0) throw new Error("An admin user already exists");
}

export function hasAdminUser(db: Database): boolean {
  const row = db.query<{ id: number }, []>("SELECT id FROM admin_users LIMIT 1").get();
  return row !== null;
}

export function getAdminUsername(db: Database): string | null {
  const row = db.query<{ username: string }, []>("SELECT username FROM admin_users LIMIT 1").get();
  return row?.username ?? null;
}

// bcrypt hash of a random string, verified against when the username is unknown so
// that a failed login takes the same time whether or not the account exists.
let dummyHash: Promise<string> | undefined;

/**
 * Validate admin credentials. Returns the username on success, null on failure.
 * Constant-time comparison is handled by bcrypt verify.
 */
export async function validateAdminCredentials(
  db: Database,
  username: string,
  password: string,
): Promise<string | null> {
  const row = db
    .query<{ username: string; password_hash: string }, [string]>(
      "SELECT username, password_hash FROM admin_users WHERE username = ?",
    )
    .get(username);

  if (!row) {
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    return null;
  }
  const valid = await verifyPassword(password, row.password_hash);
  return valid ? row.username : null;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Create a new API key. Returns the raw key (shown once — never stored).
 */
export function createApiKey(
  db: Database,
  name: string,
  expiresAt?: string,
): { id: string; rawKey: string } {
  const id = crypto.randomUUID();
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = hashKey(rawKey);

  db.query<null, [string, string, string, string | null]>(
    "INSERT INTO api_keys (id, name, key_hash, expires_at) VALUES (?, ?, ?, ?)",
  ).run(id, name, keyHash, expiresAt ?? null);

  return { id, rawKey };
}

export function listApiKeys(db: Database): ApiKey[] {
  return db
    .query<
      {
        id: string;
        name: string;
        expires_at: string | null;
        last_used_at: string | null;
        revoked_at: string | null;
        created_at: string;
      },
      []
    >(
      "SELECT id, name, expires_at, last_used_at, revoked_at, created_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at",
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      expiresAt: r.expires_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
    }));
}

/**
 * Change the admin password. Every existing session for that user is revoked,
 * so a stolen cookie stops working as soon as the password changes.
 */
export async function updateAdminPassword(
  db: Database,
  username: string,
  newPassword: string,
): Promise<void> {
  const hash = await hashPassword(newPassword);
  const result = db
    .query<null, [string, string]>("UPDATE admin_users SET password_hash = ? WHERE username = ?")
    .run(hash, username);
  if (result.changes === 0) {
    throw new Error("User not found");
  }
  revokeAllSessions(db, username);
}

export function revokeApiKey(db: Database, id: string): boolean {
  const result = db
    .query<null, [string]>(
      "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Validate a raw API key against the database.
 * Updates `last_used_at` on success.
 * Returns true if the key is valid, active, and not expired.
 *
 * `expires_at` is user-supplied (ISO 8601 or SQLite format), so both sides go
 * through datetime() before comparing; an unparseable expiry never validates.
 */
export function validateApiKey(db: Database, rawKey: string): boolean {
  const keyHash = hashKey(rawKey);
  const row = db
    .query<{ id: string }, [string]>(
      `SELECT id FROM api_keys
       WHERE key_hash = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
    )
    .get(keyHash);

  if (!row) return false;

  db.query<null, [string]>("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(
    row.id,
  );

  return true;
}

// ---------------------------------------------------------------------------
// Session tokens (signed with SESSION_SECRET via HMAC-SHA256)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionClaims {
  username: string;
  /** Row id in the `sessions` table; null for tokens minted without a server-side session. */
  sessionId: string | null;
  expiresAt: number | null;
}

/**
 * Create a signed session token encoding the username.
 * Format: `<base64url-payload>.<hex-signature>`
 * Tokens expire after 7 days (exp claim).
 *
 * A token on its own is stateless and cannot be revoked. The server uses
 * `createSession()` instead, which also records the session in the database.
 */
export function createSessionToken(secret: string, username: string, sessionId?: string): string {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      iat: now,
      exp: now + SESSION_TTL_MS,
      ...(sessionId ? { sid: sessionId } : {}),
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function readSessionToken(secret: string, token: string): SessionClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: unknown;
      exp?: unknown;
      sid?: unknown;
    };
    if (typeof data.u !== "string") return null;
    if (typeof data.exp === "number" && Date.now() > data.exp) return null;
    return {
      username: data.u,
      sessionId: typeof data.sid === "string" ? data.sid : null,
      expiresAt: typeof data.exp === "number" ? data.exp : null,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a session token's signature and expiry. Returns the username if valid, null otherwise.
 * This does NOT check revocation — use `verifySession()` for anything that grants access.
 */
export function verifySessionToken(secret: string, token: string): string | null {
  return readSessionToken(secret, token)?.username ?? null;
}

// ---------------------------------------------------------------------------
// Server-side sessions (revocable)
// ---------------------------------------------------------------------------

/**
 * Start a session: records it in the `sessions` table and returns the signed
 * cookie value. Expired sessions are pruned as a side effect.
 */
export function createSession(db: Database, secret: string, username: string): string {
  const sessionId = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.query<null, []>(
    "DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  ).run();
  db.query<null, [string, string, string]>(
    "INSERT INTO sessions (id, username, expires_at) VALUES (?, ?, ?)",
  ).run(sessionId, username, expiresAt);
  return createSessionToken(secret, username, sessionId);
}

/**
 * Verify a session cookie: valid signature, not expired, and its session still
 * exists (not logged out, not revoked by a password change). Returns the username.
 */
export function verifySession(db: Database, secret: string, token: string): string | null {
  const claims = readSessionToken(secret, token);
  if (!claims?.sessionId) return null;
  const row = db
    .query<{ username: string; expires_at: string }, [string]>(
      "SELECT username, expires_at FROM sessions WHERE id = ?",
    )
    .get(claims.sessionId);
  if (!row || row.username !== claims.username) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row.username;
}

/** End the session a cookie belongs to (logout). Returns true if a session was removed. */
export function revokeSession(db: Database, secret: string, token: string): boolean {
  const claims = readSessionToken(secret, token);
  if (!claims?.sessionId) return false;
  const result = db
    .query<null, [string]>("DELETE FROM sessions WHERE id = ?")
    .run(claims.sessionId);
  return result.changes > 0;
}

/** End every session for `username` (or for everyone when omitted). Returns the number removed. */
export function revokeAllSessions(db: Database, username?: string): number {
  const result =
    username === undefined
      ? db.query<null, []>("DELETE FROM sessions").run()
      : db.query<null, [string]>("DELETE FROM sessions WHERE username = ?").run(username);
  return result.changes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}
