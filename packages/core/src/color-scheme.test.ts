import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { createSnapshot, defaultColorScheme, parseColorScheme } from "./pipeline";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `scheme-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

const schemeOf = async (id: number) =>
  (
    await db.get<{ color_scheme: string | null }>(
      sql`SELECT color_scheme FROM snapshots WHERE id = ${id}`,
    )
  )?.color_scheme;

describe("snapshot color scheme", () => {
  test("is stored on the snapshot row when asked for", async () => {
    const id = await createSnapshot(db, "https://example.com/a", { colorScheme: "dark" });
    expect(await schemeOf(id)).toBe("dark");
  });

  test("is NULL when omitted, so the server default applies at archive time", async () => {
    const id = await createSnapshot(db, "https://example.com/b");
    expect(await schemeOf(id)).toBeNull();
  });

  test("parseColorScheme accepts only light and dark", () => {
    expect(parseColorScheme("dark")).toBe("dark");
    expect(parseColorScheme("light")).toBe("light");
    expect(parseColorScheme("blue")).toBeUndefined();
    expect(parseColorScheme(null)).toBeUndefined();
  });

  test("defaultColorScheme reads WEBFROST_COLOR_SCHEME, light otherwise", () => {
    const saved = process.env.WEBFROST_COLOR_SCHEME;
    try {
      Reflect.deleteProperty(process.env, "WEBFROST_COLOR_SCHEME");
      expect(defaultColorScheme()).toBe("light");
      process.env.WEBFROST_COLOR_SCHEME = "dark";
      expect(defaultColorScheme()).toBe("dark");
      process.env.WEBFROST_COLOR_SCHEME = "sepia";
      expect(defaultColorScheme()).toBe("light");
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_COLOR_SCHEME");
      else process.env.WEBFROST_COLOR_SCHEME = saved;
    }
  });
});
