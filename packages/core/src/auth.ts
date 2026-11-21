import { createHash, createHmac, randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { Db } from "./db";

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

export async function createAdminUser(db: Db, username: string, password: string): Promise<void> {
  if (await hasAdminUser(db)) throw new Error("An admin user already exists");

  const hash = await hashPassword(password);
  // Hashing is slow and asynchronous, so two concurrent setups can both pass the
  // check above. The insert re-checks atomically: only one of them creates the admin.
  const created = await db.transaction(async (tx) => {
    // On PostgreSQL/MySQL a NOT EXISTS check is not atomic across transactions;
    // locking the (one-row) table makes it so. SQLite's BEGIN IMMEDIATE already
    // admits a single writer.
    if (tx.dialect === "postgres") await tx.run(sql`LOCK TABLE admin_users IN EXCLUSIVE MODE`);
    // MySQL: a locking read takes a next-key lock even on an empty table; two
    // racing setups then deadlock on insert and the loser is retried, finding the admin.
    const exists = await tx.get<{ id: number }>(
      sql`SELECT id FROM admin_users LIMIT 1 ${tx.dialect === "mysql" ? sql`FOR UPDATE` : sql``}`,
    );
    if (exists) return false;
    await tx.run(
      sql`INSERT INTO admin_users (username, password_hash, created_at) VALUES (${username}, ${hash}, ${tx.now()})`,
    );
    return true;
  });
  if (!created) throw new Error("An admin user already exists");
}

export async function hasAdminUser(db: Db): Promise<boolean> {
  const row = await db.get<{ id: number }>(sql`SELECT id FROM admin_users LIMIT 1`);
  return row !== null;
}

export async function getAdminUsername(db: Db): Promise<string | null> {
  const row = await db.get<{ username: string }>(
    sql`SELECT username FROM admin_users ORDER BY id LIMIT 1`,
  );
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
  db: Db,
  username: string,
  password: string,
): Promise<string | null> {
  const row = await db.get<{ username: string; password_hash: string }>(
    sql`SELECT username, password_hash FROM admin_users WHERE username = ${username}`,
  );

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
export async function createApiKey(
  db: Db,
  name: string,
  expiresAt?: string,
): Promise<{ id: string; rawKey: string }> {
  const id = crypto.randomUUID();
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = hashKey(rawKey);

  await db.run(
    sql`INSERT INTO api_keys (id, name, key_hash, expires_at, created_at) VALUES (${id}, ${name}, ${keyHash}, ${expiresAt ?? null}, ${db.now()})`,
  );

  return { id, rawKey };
}

export async function listApiKeys(db: Db): Promise<ApiKey[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    expires_at: string | null;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }>(
    sql`SELECT id, name, expires_at, last_used_at, revoked_at, created_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at`,
  );
  return rows.map((r) => ({
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
  db: Db,
  username: string,
  newPassword: string,
): Promise<void> {
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    const changes = await tx.run(
      sql`UPDATE admin_users SET password_hash = ${hash} WHERE username = ${username}`,
    );
    if (changes === 0) {
      throw new Error("User not found");
    }
    await revokeAllSessions(tx, username);
  });
}

export async function revokeApiKey(db: Db, id: string): Promise<boolean> {
  const changes = await db.run(
    sql`UPDATE api_keys SET revoked_at = ${db.now()} WHERE id = ${id} AND revoked_at IS NULL`,
  );
  return changes > 0;
}

/**
 * Parse a stored timestamp. Zone-less values ("2030-01-01 00:00:00", the
 * database format, or an ISO string without offset) are UTC, as SQLite's
 * datetime() reads them. Returns NaN for anything unparseable.
 */
export function parseDbTimestamp(value: string): number {
  const m =
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value.trim(),
    );
  if (!m) return Number.NaN;
  const [, date, time, zone] = m;
  return Date.parse(`${date}T${time ?? "00:00:00"}${zone ?? "Z"}`);
}

/**
 * Validate a raw API key against the database.
 * Updates `last_used_at` on success.
 * Returns true if the key is valid, active, and not expired.
 *
 * `expires_at` is user-supplied (ISO 8601 or SQLite format) and parsed with
 * `parseDbTimestamp`; an unparseable expiry never validates.
 */
export async function validateApiKey(db: Db, rawKey: string): Promise<boolean> {
  const keyHash = hashKey(rawKey);
  const row = await db.get<{ id: string; expires_at: string | null }>(
    sql`SELECT id, expires_at FROM api_keys WHERE key_hash = ${keyHash} AND revoked_at IS NULL`,
  );

  if (!row) return false;
  // Compared in app code so every database applies the same parsing rules.
  if (row.expires_at !== null && !(parseDbTimestamp(row.expires_at) > Date.now())) return false;

  await db.run(sql`UPDATE api_keys SET last_used_at = ${db.now()} WHERE id = ${row.id}`);

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
export async function createSession(db: Db, secret: string, username: string): Promise<string> {
  const sessionId = randomBytes(16).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  // expires_at is always an ISO string written here, so text comparison is exact.
  await db.run(sql`DELETE FROM sessions WHERE expires_at <= ${now.toISOString()}`);
  await db.run(
    sql`INSERT INTO sessions (id, username, expires_at, created_at) VALUES (${sessionId}, ${username}, ${expiresAt}, ${db.now()})`,
  );
  return createSessionToken(secret, username, sessionId);
}

/**
 * Verify a session cookie: valid signature, not expired, and its session still
 * exists (not logged out, not revoked by a password change). Returns the username.
 */
export async function verifySession(db: Db, secret: string, token: string): Promise<string | null> {
  const claims = readSessionToken(secret, token);
  if (!claims?.sessionId) return null;
  const row = await db.get<{ username: string; expires_at: string }>(
    sql`SELECT username, expires_at FROM sessions WHERE id = ${claims.sessionId}`,
  );
  if (!row || row.username !== claims.username) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row.username;
}

/** End the session a cookie belongs to (logout). Returns true if a session was removed. */
export async function revokeSession(db: Db, secret: string, token: string): Promise<boolean> {
  const claims = readSessionToken(secret, token);
  if (!claims?.sessionId) return false;
  return (await db.run(sql`DELETE FROM sessions WHERE id = ${claims.sessionId}`)) > 0;
}

/** End every session for `username` (or for everyone when omitted). Returns the number removed. */
export async function revokeAllSessions(db: Db, username?: string): Promise<number> {
  return username === undefined
    ? db.run(sql`DELETE FROM sessions`)
    : db.run(sql`DELETE FROM sessions WHERE username = ${username}`);
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
