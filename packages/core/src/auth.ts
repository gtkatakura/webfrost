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
  db.query<null, [string, string]>(
    "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
  ).run(username, hash);
}

export function hasAdminUser(db: Database): boolean {
  const row = db.query<{ id: number }, []>("SELECT id FROM admin_users LIMIT 1").get();
  return row !== null;
}

export function getAdminUsername(db: Database): string | null {
  const row = db.query<{ username: string }, []>("SELECT username FROM admin_users LIMIT 1").get();
  return row?.username ?? null;
}

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

  if (!row) return null;
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

export function revokeApiKey(db: Database, id: string): boolean {
  const result = db
    .query<null, [string]>(
      "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
    )
    .run(id);
  return (result as unknown as { changes: number }).changes > 0;
}

/**
 * Validate a raw API key against the database.
 * Updates `last_used_at` on success.
 * Returns true if the key is valid, active, and not expired.
 */
export function validateApiKey(db: Database, rawKey: string): boolean {
  const keyHash = hashKey(rawKey);
  const row = db
    .query<{ id: string }, [string]>(
      `SELECT id FROM api_keys
       WHERE key_hash = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
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

/**
 * Create a signed session token encoding the username.
 * Format: `<base64url-payload>.<hex-signature>`
 */
export function createSessionToken(secret: string, username: string): string {
  const payload = Buffer.from(JSON.stringify({ u: username, iat: Date.now() })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Verify a session token. Returns the username if valid, null otherwise.
 */
export function verifySessionToken(secret: string, token: string): string | null {
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
      iat?: unknown;
    };
    if (typeof data.u !== "string") return null;
    return data.u;
  } catch {
    return null;
  }
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
