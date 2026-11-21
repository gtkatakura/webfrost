import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { isSqliteRun } from "./test-utils";

/**
 * Regression guard for a Bun runtime bug (seen on 1.3.5 and 1.3.11, fixed by 1.4.4).
 *
 * A `node:child_process` spawn with extra stdio pipes (fd 3 and up) closed those pipe
 * descriptors once when the child exited, then closed the same descriptor numbers a
 * second time when the ChildProcess was garbage-collected. By then the kernel had
 * handed those numbers to whatever opened a file next, typically a SQLite archive
 * connection, so the connection lost its database or WAL file and failed with
 * SQLITE_IOERR_READ / _WRITE / _SHORT_READ (or, worse, wrote into an unrelated file).
 *
 * Playwright launches Chromium exactly like that (`--remote-debugging-pipe` on fds 3
 * and 4), so every archive with a browser step could break an open connection: that was
 * the "disk I/O error" scheduler tests hit in CI whenever a GC ran at the wrong moment.
 * This test fails on an affected Bun; keep it so a downgrade cannot bring that back.
 */

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `runtime-fds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Spawn and reap a child the way Playwright launches Chromium, leaving nothing referenced. */
async function runChildWithExtraPipes(): Promise<void> {
  // The child has to outlive the setup of the parent's pipe readers (as Chromium does):
  // one that exits at once does not trigger the double close.
  const child = spawn("sh", ["-c", "echo ready >&4; sleep 0.2; exit 0"], {
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  (child.stdio[4] as NodeJS.ReadableStream | null)?.resume();
  await new Promise((resolve) => child.on("close", resolve));
}

test.skipIf(!isSqliteRun)(
  "SQLite connections survive the GC of a finished child that had extra stdio pipes",
  async () => {
    await runChildWithExtraPipes();
    // Let the child's own close handling finish, so its descriptor numbers are free again.
    await Bun.sleep(50);

    // Several connections so the freed descriptor numbers are certainly reused by archive files.
    const dbs: Db[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const dir = join(testDir, `a${i}`);
        mkdirSync(dir);
        dbs.push(await openDb(dir));
      }
      for (let i = 0; i < 5; i++) {
        Bun.gc(true);
        await Bun.sleep(20);
      }
      for (const db of dbs) {
        // Write through the WAL and read back: both fail if a descriptor was closed underneath.
        await db.run(
          sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com/', 'done')`,
        );
        expect((await db.get<{ n: number }>(sql`SELECT count(*) AS n FROM snapshots`))?.n).toBe(1);
      }
    } finally {
      for (const db of dbs) await db.close();
    }
  },
);
