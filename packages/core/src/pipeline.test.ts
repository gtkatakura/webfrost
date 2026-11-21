import type Database from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { JobRunner } from "./jobs";
import { createSnapshot, runPipeline, withTimeout } from "./pipeline";
import { searchSnapshots } from "./search";

const ARTICLE = `<!doctype html><html><head><title>Frost Report</title></head><body>
<article><h1>Frost Report</h1>
<p>${"Glaciers keep a long memory of the weather. ".repeat(30)}</p>
<p>${"Archivists keep a long memory of the web. ".repeat(30)}</p>
</article></body></html>`;

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00, 0x80]);

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let testDir: string;
let db: Database;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/report.pdf") {
        return new Response(PDF_BYTES, { headers: { "content-type": "application/pdf" } });
      }
      if (pathname === "/article") {
        return new Response(ARTICLE, { headers: { "content-type": "text/html" } });
      }
      return new Response("nope", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
  for (const key of ["WEBFROST_ALLOW_PRIVATE_URLS", "WEBFROST_DOMAIN_DELAY_MS"]) {
    savedEnv[key] = process.env[key];
  }
  // The fixture server is on loopback, which the SSRF guard rejects by default.
  process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
});

afterAll(() => {
  server.stop(true);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  testDir = join(tmpdir(), `pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

function results(snapshotId: number) {
  return db
    .query<{ extractor: string; error: string | null; content: string | null }, [number]>(
      "SELECT extractor, error, content FROM archive_results WHERE snapshot_id = ? ORDER BY id",
    )
    .all(snapshotId);
}

function statusOf(snapshotId: number) {
  return db
    .query<{ status: string }, [number]>("SELECT status FROM snapshots WHERE id = ?")
    .get(snapshotId)?.status;
}

describe("runPipeline", () => {
  test("archives a page: snapshot done, job done, text formats stored and indexed", async () => {
    const url = `${baseUrl}/article`;
    const id = createSnapshot(db, url);
    expect(db.query<{ status: string }, []>("SELECT status FROM job_queue").get()?.status).toBe(
      "pending",
    );

    await runPipeline(db, id, url, testDir);

    expect(statusOf(id)).toBe("done");
    expect(db.query<{ status: string }, []>("SELECT status FROM job_queue").get()?.status).toBe(
      "done",
    );

    const ok = results(id)
      .filter((r) => r.error === null)
      .map((r) => r.extractor);
    expect(ok).toContain("html");
    expect(ok).toContain("warc");
    expect(ok).toContain("readability");

    expect(searchSnapshots(db, "glaciers").items.map((r) => r.id)).toEqual([id]);
  }, 60_000);

  test("accounts for every browser extractor: one row each, success or recorded failure", async () => {
    const url = `${baseUrl}/article`;
    const id = createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    // Whether or not Chromium is installed on this machine, nothing is skipped silently.
    for (const name of ["pdf", "screenshot", "dom-snapshot", "singlefile"]) {
      const rows = results(id).filter((r) => r.extractor === name);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.error === null ? row.content : row?.error).toBeTruthy();
    }
  }, 60_000);

  test("marks the snapshot failed when the page cannot be fetched", async () => {
    const url = `${baseUrl}/missing`;
    const id = createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    expect(statusOf(id)).toBe("failed");
    expect(db.query<{ status: string }, []>("SELECT status FROM job_queue").get()?.status).toBe(
      "failed",
    );
    expect(results(id)).toHaveLength(0);
  });

  test("refuses private addresses unless explicitly allowed", async () => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "false";
    try {
      const url = `${baseUrl}/article`;
      const id = createSnapshot(db, url);
      await runPipeline(db, id, url, testDir);
      expect(statusOf(id)).toBe("failed");
    } finally {
      process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    }
  });
});

describe("runPipeline: content and cancellation", () => {
  test("a binary URL goes to the WARC byte for byte; html and readability do not run", async () => {
    const url = `${baseUrl}/report.pdf`;
    const id = createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    const rows = results(id);
    expect(rows.some((r) => r.extractor === "html" || r.extractor === "readability")).toBe(false);
    const warc = rows.find((r) => r.extractor === "warc");
    expect(warc?.error).toBeNull();
    const bytes = new Uint8Array(readFileSync(warc?.content ?? ""));
    expect(Buffer.from(bytes).includes(Buffer.from(PDF_BYTES))).toBe(true);
    expect(statusOf(id)).toBe("done");
  }, 60_000);

  test("a yt-dlp that hangs is killed together with its children", async () => {
    // A stand-in yt-dlp that starts a helper (as yt-dlp starts ffmpeg) and hangs.
    const binDir = join(testDir, "bin");
    mkdirSync(binDir);
    const pidFile = join(testDir, "helper.pid");
    writeFileSync(
      join(binDir, "yt-dlp"),
      `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nsleep 60\n`,
    );
    chmodSync(join(binDir, "yt-dlp"), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath}`;
    process.env.WEBFROST_MEDIA_TIMEOUT_MS = "500";
    try {
      const url = `${baseUrl}/article`;
      const id = createSnapshot(db, url);
      const start = Date.now();
      await runPipeline(db, id, url, testDir);
      expect(Date.now() - start).toBeLessThan(30_000);
      expect(results(id).some((r) => r.extractor === "media")).toBe(false);

      const helper = Number(readFileSync(pidFile, "utf8").trim());
      expect(helper).toBeGreaterThan(0);
      expect(processGone(helper)).toBe(true);
    } finally {
      process.env.PATH = savedPath;
      Reflect.deleteProperty(process.env, "WEBFROST_MEDIA_TIMEOUT_MS");
    }
  }, 60_000);
});

/** True when `pid` is not running (gone, or a zombie waiting for init to reap it). */
function processGone(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
  } catch {
    return true;
  }
}

describe("JobRunner", () => {
  test("finishes a job after the caller closed its own connection", async () => {
    // Regression: the server inserted the snapshot, handed its connection to the
    // background pipeline and closed it — every imported snapshot stayed pending.
    const runner = new JobRunner({ dir: testDir, concurrency: 2 });
    const callerDb = openDb(testDir);
    const id = runner.add(callerDb, `${baseUrl}/article`);
    callerDb.close();

    await runner.onIdle();

    expect(statusOf(id)).toBe("done");
    expect(runner.size).toBe(0);
  }, 60_000);

  test("recoverPending re-runs orphaned snapshots without duplicating results", async () => {
    const url = `${baseUrl}/article`;
    const id = createSnapshot(db, url);
    // Simulate a process that died mid-pipeline: job running, heartbeat long gone,
    // one result already stored.
    db.query(
      "UPDATE job_queue SET status = 'running', heartbeat_at = datetime('now', '-10 minutes') WHERE snapshot_id = ?",
    ).run(id);
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', 'stale')",
    ).run(id);

    const runner = new JobRunner({ dir: testDir });
    expect(runner.recoverPending()).toBe(1);
    await runner.onIdle();

    expect(statusOf(id)).toBe("done");
    const html = results(id).filter((r) => r.extractor === "html");
    expect(html).toHaveLength(1);
    expect(html[0]?.content).toContain("Frost Report");
  }, 60_000);

  test("recoverPending leaves a job alone while another process is still working on it", () => {
    // Another process (a CLI worker next to the server, say) created this snapshot
    // and is running it: its heartbeat is fresh.
    const id = createSnapshot(db, `${baseUrl}/article`);
    db.query("UPDATE job_queue SET status = 'running' WHERE snapshot_id = ?").run(id);
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', 'in progress')",
    ).run(id);

    expect(new JobRunner({ dir: testDir }).recoverPending()).toBe(0);

    // Nothing of the live run was thrown away.
    expect(results(id)).toHaveLength(1);
    expect(statusOf(id)).toBe("pending");
  });

  test("recoverPending adopts an orphan only once", async () => {
    const id = createSnapshot(db, `${baseUrl}/article`);
    db.query(
      "UPDATE job_queue SET heartbeat_at = datetime('now', '-10 minutes') WHERE snapshot_id = ?",
    ).run(id);

    const first = new JobRunner({ dir: testDir });
    const second = new JobRunner({ dir: testDir });
    expect(first.recoverPending()).toBe(1);
    // The first runner's adoption renewed the lease.
    expect(second.recoverPending()).toBe(0);
    expect(first.recoverPending()).toBe(0);

    await first.onIdle();
    expect(statusOf(id)).toBe("done");
    expect(results(id).filter((r) => r.extractor === "html")).toHaveLength(1);
  }, 60_000);

  test("recoverPending gives up on a job that keeps getting interrupted", () => {
    const id = createSnapshot(db, `${baseUrl}/article`);
    db.query(
      "UPDATE job_queue SET attempts = 3, heartbeat_at = datetime('now', '-10 minutes') WHERE snapshot_id = ?",
    ).run(id);

    expect(new JobRunner({ dir: testDir }).recoverPending()).toBe(0);
    expect(statusOf(id)).toBe("failed");
  });

  test("a burst of URLs for one host does not hold up another host", async () => {
    process.env.WEBFROST_DOMAIN_DELAY_MS = "300";
    try {
      // Same fixture server, reached under two host names; neither path exists, so
      // each job is just one quick fetch.
      const port = new URL(baseUrl).port;
      const slowHost = `http://throttle-a.localhost:${port}`;
      const otherHost = `http://throttle-b.localhost:${port}`;
      const runner = new JobRunner({ dir: testDir, concurrency: 1 });
      const finished: string[] = [];
      const track = (label: string, url: string) =>
        runner.enqueue(createSnapshot(db, url), url).then(() => finished.push(label));

      await Promise.all([
        track("a1", `${slowHost}/1`),
        track("a2", `${slowHost}/2`),
        track("a3", `${slowHost}/3`),
        track("b1", `${otherHost}/1`),
      ]);

      // b1 was queued last but only had to wait for a1, not for the whole throttled burst.
      expect(finished.indexOf("b1")).toBeLessThan(finished.indexOf("a2"));
      expect(finished.indexOf("a2")).toBeLessThan(finished.indexOf("a3"));
    } finally {
      process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
    }
  });

  test("recoverPending ignores finished snapshots", () => {
    const id = createSnapshot(db, `${baseUrl}/article`);
    db.query("UPDATE snapshots SET status = 'done' WHERE id = ?").run(id);
    expect(new JobRunner({ dir: testDir }).recoverPending()).toBe(0);
  });

  test("never runs more pipelines at once than the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const slow = Bun.serve({
      port: 0,
      async fetch() {
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(150);
        active--;
        return new Response("gone", { status: 404 });
      },
    });
    try {
      const runner = new JobRunner({ dir: testDir, concurrency: 2 });
      for (let i = 0; i < 6; i++) runner.add(db, `http://127.0.0.1:${slow.port}/p${i}`);
      await runner.onIdle();
      expect(peak).toBe(2);
    } finally {
      slow.stop(true);
    }
  });
});

describe("withTimeout", () => {
  test("rejects when the promise takes too long", async () => {
    await expect(withTimeout(Bun.sleep(200), 20, "slow op")).rejects.toThrow(
      "slow op timed out after 20ms",
    );
  });

  test("passes the value through when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "fast op")).resolves.toBe(42);
  });

  test("0 disables the cap", async () => {
    await expect(
      withTimeout(
        Bun.sleep(30).then(() => "ok"),
        0,
        "uncapped",
      ),
    ).resolves.toBe("ok");
  });
});
