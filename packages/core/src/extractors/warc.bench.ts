import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "mitata";
import { openDb } from "../db";
import { warcExtractor } from "./warc";

const testDir = join(tmpdir(), `warc-bench-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
const db = openDb(testDir);
db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')").run();

const snapshotDir = join(testDir, "snapshots", "1");
mkdirSync(snapshotDir, { recursive: true });
const mockHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
const html = `<html><body>${"x".repeat(10_000)}</body></html>`;

bench("warcExtractor: build + write 10KB page", async () => {
  await warcExtractor(db, 1, "https://example.com", mockHeaders, 200, "OK", html, snapshotDir);
});

await run();
db.close();
try {
  rmSync(testDir, { recursive: true, force: true });
} catch {
  // best-effort
}
