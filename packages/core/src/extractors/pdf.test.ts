import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import type { Page } from "playwright";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { pdfExtractor } from "./pdf";

/** Minimal Page stub whose pdf() always throws (simulates Playwright unavailable). */
function makeFailingPage(): Page {
  return {
    pdf: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `pdf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')`);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

describe("pdfExtractor", () => {
  test("rejects when page.pdf() fails so the pipeline can record the failure", async () => {
    const page = makeFailingPage();

    await expect(pdfExtractor(db, 1, makeStorage(), page)).rejects.toThrow(
      "Playwright unavailable",
    );
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await pdfExtractor(db, 1, makeStorage(), page).catch(() => {});

    const rows = await db.all<{ extractor: string }>(
      sql`SELECT extractor FROM archive_results WHERE snapshot_id = 1`,
    );

    // No row should exist since extraction failed (no PDF written)
    const pdfRow = rows.find((r) => r.extractor === "pdf");
    expect(pdfRow).toBeUndefined();
  });

  test("prints backgrounds, so a dark page is not light text on white paper", async () => {
    const calls: Array<{ path?: string; printBackground?: boolean }> = [];
    const page = {
      pdf: async (opts: { path?: string; printBackground?: boolean }) => {
        calls.push(opts);
        await Bun.write(opts.path ?? "", "%PDF-1.4");
      },
    } as unknown as Page;

    await pdfExtractor(db, 1, makeStorage(), page);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.printBackground).toBe(true);
    const row = await db.get<{ error: string | null }>(
      sql`SELECT error FROM archive_results WHERE snapshot_id = 1 AND extractor = 'pdf'`,
    );
    expect(row?.error).toBeNull();
  });
});
