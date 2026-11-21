import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { bench, run } from "mitata";
import { type Db, openDb } from "../db";
import { FilesystemBackend } from "../storage";
import { warcExtractor } from "./warc";

const testDir = join(tmpdir(), `warc-bench-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
const db = await openDb(testDir);
await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')`);

const storage = new FilesystemBackend(join(testDir, "snapshots"));
const mockHeaders = new Headers({ "content-type": "text/html; charset=utf-8" });
const body = new TextEncoder().encode(`<html><body>${"x".repeat(10_000)}</body></html>`);
const source = {
  url: "https://example.com",
  requestedUrl: "https://example.com",
  status: 200,
  statusText: "OK",
  headers: mockHeaders,
  body,
  redirects: [],
};

bench("warcExtractor: build + write 10KB page", async () => {
  await warcExtractor(db, 1, source, storage);
});

await run();
await db.close();
try {
  rmSync(testDir, { recursive: true, force: true });
} catch {
  // best-effort
}
