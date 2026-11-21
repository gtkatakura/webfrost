import { mkdirSync } from "node:fs";
import { type Db, openDb } from "@webfrost/core";
import type { Context } from "../cli";

/**
 * Run `fn` with the archive database open and close it afterwards, however `fn` ends.
 * Every command that touches the archive goes through here, so the connection is
 * opened and closed in exactly one place.
 */
export async function withDb<T>(
  ctx: Pick<Context, "dir">,
  fn: (db: Db) => T | Promise<T>,
): Promise<T> {
  mkdirSync(ctx.dir, { recursive: true });
  const db = await openDb(ctx.dir);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** Print a value as pretty JSON on stdout (the `--json` output of a command). */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** A note for humans on stderr (pagination hints and the like); silenced by --quiet. */
export function hint(ctx: Context, message: string): void {
  if (!ctx.quiet) process.stderr.write(`${message}\n`);
}
