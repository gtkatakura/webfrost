import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDb } from "./db";
import { listImports, recordImport } from "./import-history";

let dir: string;
let db: Db;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "webfrost-import-history-"));
  db = await openDb(dir);
  for (const id of ["a", "b", "c"]) {
    await recordImport(db, { id, source_url: null, format: "text", queued: 1, skipped: 0 });
  }
});

afterEach(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("listImports clamps a bad limit or offset instead of failing", async () => {
  expect(await listImports(db, 2, 0)).toHaveLength(2);
  expect(await listImports(db, 2, 2)).toHaveLength(1);
  // Fractions, negatives, NaN and Infinity fall back to the defaults or are truncated.
  expect(await listImports(db, 1.9, 0)).toHaveLength(1);
  expect(await listImports(db, Number.NaN, -5)).toHaveLength(3);
  expect(await listImports(db, Number.POSITIVE_INFINITY, Number.NaN)).toHaveLength(3);
  expect(await listImports(db, 0, 1.5)).toHaveLength(2);
});
