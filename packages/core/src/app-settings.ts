import { sql } from "kysely";
import type { Db } from "./db";

/**
 * Settings changed from the web UI, kept in the archive (`app_settings`) so they survive a restart and
 * need no environment variable. Each one has a default that applies until it is set.
 */
export const TRASH_RETENTION_DAYS = { name: "trash_retention_days", default: 30, min: 1, max: 365 };

async function getSetting(db: Db, name: string): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    sql`SELECT value FROM app_settings WHERE name = ${name}`,
  );
  return row?.value ?? null;
}

async function setSetting(db: Db, name: string, value: string): Promise<void> {
  const updated = await db.run(
    sql`UPDATE app_settings SET value = ${value}, updated_at = ${db.now()} WHERE name = ${name}`,
  );
  if (updated > 0) return;
  try {
    await db.run(
      sql`INSERT INTO app_settings (name, value, updated_at) VALUES (${name}, ${value}, ${db.now()})`,
    );
  } catch {
    // Set by another request between the two statements: write ours over it.
    await db.run(
      sql`UPDATE app_settings SET value = ${value}, updated_at = ${db.now()} WHERE name = ${name}`,
    );
  }
}

/** Days a snapshot stays in the trash before it is deleted for good. */
export async function getTrashRetentionDays(db: Db): Promise<number> {
  const raw = Number(await getSetting(db, TRASH_RETENTION_DAYS.name));
  return Number.isInteger(raw) && raw >= TRASH_RETENTION_DAYS.min && raw <= TRASH_RETENTION_DAYS.max
    ? raw
    : TRASH_RETENTION_DAYS.default;
}

export class SettingRangeError extends Error {}

export async function setTrashRetentionDays(db: Db, days: number): Promise<void> {
  if (
    !Number.isInteger(days) ||
    days < TRASH_RETENTION_DAYS.min ||
    days > TRASH_RETENTION_DAYS.max
  ) {
    throw new SettingRangeError(
      `trash retention must be a whole number of days from ${TRASH_RETENTION_DAYS.min} to ${TRASH_RETENTION_DAYS.max}`,
    );
  }
  await setSetting(db, TRASH_RETENTION_DAYS.name, String(days));
}
