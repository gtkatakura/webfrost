import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { domSnapshotExtractor } from "./dom-snapshot";

/** Minimal Page stub whose content() always throws. */
function makeFailingPage(): Page {
  return {
    content: async () => {
      throw new Error("Playwright unavailable (stub)");
    },
  } as unknown as Page;
}

/** Minimal Page stub that returns a fixed HTML string. */
function makeSuccessPage(html: string): Page {
  return {
    content: async () => html,
  } as unknown as Page;
}

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `dom-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')").run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

describe("domSnapshotExtractor", () => {
  test("rejects when page.content() fails so the pipeline can record the failure", async () => {
    const page = makeFailingPage();

    await expect(domSnapshotExtractor(db, 1, makeStorage(), page)).rejects.toThrow(
      "Playwright unavailable",
    );
  });

  test("does not insert archive_result row when extraction fails", async () => {
    const page = makeFailingPage();

    await domSnapshotExtractor(db, 1, makeStorage(), page).catch(() => {});

    const rows = db
      .query<{ extractor: string }, []>(
        "SELECT extractor FROM archive_results WHERE snapshot_id = 1",
      )
      .all();

    expect(rows.find((r) => r.extractor === "dom-snapshot")).toBeUndefined();
  });

  test("writes dom.html and inserts archive_result row on success", async () => {
    const html = "<html><body><p>Hello JS world</p></body></html>";
    const page = makeSuccessPage(html);

    await domSnapshotExtractor(db, 1, makeStorage(), page);

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'dom-snapshot'",
      )
      .get();

    expect(row).toBeDefined();
    expect(row?.content).toEndWith("dom.html");

    expect(row?.content).toBeDefined();
    const written = await Bun.file(row?.content ?? "").text();
    expect(written).toBe(html);
  });
});
