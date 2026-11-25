import { sql } from "kysely";
import type { Db } from "./db";
import type { Failure } from "./failure";

/**
 * Domains whose name no longer resolves (NXDOMAIN). The first snapshot of such a domain records it here;
 * the next ones, typically a bookmark import with dozens of pages of one dead site, fail at once with
 * the same reason instead of each asking DNS again.
 *
 * A record is trusted for ten minutes only. "No such name" is also what a machine that is offline, or
 * a name served by a VPN that is down, answers; a record kept for long would then fail every later
 * snapshot of the domain (a schedule, an import) well after the network is back. Ten minutes still
 * spares a burst its lookups and heals by itself. Retrying a snapshot of the domain forgets the record.
 */
export const DEAD_HOST_TTL_SECONDS = 10 * 60;

/** The host a dead-domain record is keyed by: the URL's hostname, lowercased. Null for a bad URL. */
export function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** Record that `host` does not resolve, keeping when it was first seen. */
export async function markDeadHost(db: Db, host: string, detail: string): Promise<void> {
  const updated = await db.run(
    sql`UPDATE dead_hosts SET detail = ${detail}, last_seen_at = ${db.now()} WHERE host = ${host}`,
  );
  if (updated > 0) return;
  try {
    await db.run(
      sql`INSERT INTO dead_hosts (host, detail, first_seen_at, last_seen_at)
          VALUES (${host}, ${detail}, ${db.now()}, ${db.now()})`,
    );
  } catch {
    // Another run recorded it between the update and the insert: the record is there either way.
  }
}

/** The failure to report for a URL whose domain is known not to resolve, or null to go ahead. */
export async function knownDeadHost(db: Db, url: string): Promise<Failure | null> {
  const host = hostOf(url);
  if (!host) return null;
  const row = await db.get<{ detail: string | null; first_seen_at: string }>(
    sql`SELECT detail, first_seen_at FROM dead_hosts
        WHERE host = ${host} AND last_seen_at >= ${db.ago(DEAD_HOST_TTL_SECONDS)}`,
  );
  if (!row) return null;
  return {
    category: "domain_not_found",
    detail: `${host} does not resolve (known since ${row.first_seen_at} UTC${row.detail ? `: ${row.detail}` : ""})`,
  };
}

/** Forget that `host` was dead, so its next snapshot asks DNS again. */
export async function forgetDeadHost(db: Db, host: string): Promise<void> {
  await db.run(sql`DELETE FROM dead_hosts WHERE host = ${host}`);
}
