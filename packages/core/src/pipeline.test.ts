import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
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
let db: Db;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/report.pdf") {
        return new Response(PDF_BYTES, { headers: { "content-type": "application/pdf" } });
      }
      if (pathname === "/late") {
        // Like a single-page app: the content arrives with a request made after "load".
        return new Response(
          `<!doctype html><html><head><title>Late</title></head><body><main id="m">loading</main>
<script>addEventListener("load", () => setTimeout(async () => {
  const r = await fetch("/late.json");
  document.getElementById("m").textContent = (await r.json()).text;
}, 200));</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (pathname === "/scheme") {
        return new Response(
          `<!doctype html><html><head><title>Scheme</title></head><body><main id="m"></main>
<script>document.getElementById("m").textContent = "scheme:" +
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (pathname === "/reveal") {
        // Like a landing page: sections far below the first screen stay invisible until they scroll
        // into view, and an image there only gets its src then.
        return new Response(
          `<!doctype html><html><head><title>Reveal</title><style>.r{opacity:0}.r.in{opacity:1}</style></head>
<body><div style="height:3000px">top</div><section class="r" id="s">Six tools, one binary</section>
<img id="lazy" data-src="/late.json" alt="">
<script>new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) {
  e.target.classList.add("in"); const i = document.getElementById("lazy"); i.src = i.dataset.src; } }))
  .observe(document.getElementById("s"));</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (pathname === "/late.json") {
        return Response.json({ text: "arrived after load" });
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

afterAll(async () => {
  server.stop(true);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  testDir = join(tmpdir(), `pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

function results(snapshotId: number) {
  return db.all<{ extractor: string; error: string | null; content: string | null }>(
    sql`SELECT extractor, error, content FROM archive_results WHERE snapshot_id = ${snapshotId} ORDER BY id`,
  );
}

async function statusOf(snapshotId: number) {
  return (
    await db.get<{ status: string }>(sql`SELECT status FROM snapshots WHERE id = ${snapshotId}`)
  )?.status;
}

describe("runPipeline", () => {
  test("archives a page: snapshot done, job done, text formats stored and indexed", async () => {
    const url = `${baseUrl}/article`;
    const id = await createSnapshot(db, url);
    expect((await db.get<{ status: string }>(sql`SELECT status FROM job_queue`))?.status).toBe(
      "pending",
    );

    await runPipeline(db, id, url, testDir);

    expect(await statusOf(id)).toBe("done");
    expect((await db.get<{ status: string }>(sql`SELECT status FROM job_queue`))?.status).toBe(
      "done",
    );

    const ok = (await results(id)).filter((r) => r.error === null).map((r) => r.extractor);
    expect(ok).toContain("html");
    expect(ok).toContain("warc");
    expect(ok).toContain("readability");

    expect((await searchSnapshots(db, "glaciers")).items.map((r) => r.id)).toEqual([id]);
  }, 60_000);

  test("accounts for every browser extractor: one row each, success or recorded failure", async () => {
    const url = `${baseUrl}/article`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    // Whether or not Chromium is installed on this machine, nothing is skipped silently.
    for (const name of ["pdf", "screenshot", "dom-snapshot", "singlefile"]) {
      const rows = (await results(id)).filter((r) => r.extractor === name);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.error === null ? row.content : row?.error).toBeTruthy();
    }
  }, 60_000);

  test("captures what a page loads after the load event, not a half-built page", async () => {
    const url = `${baseUrl}/late`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    const dom = (await results(id)).find((r) => r.extractor === "dom-snapshot");
    if (dom?.error) return; // No Chromium on this machine: covered where there is one (CI).
    const html = readFileSync(dom?.content ?? "", "utf8");
    expect(html).toContain("arrived after load");
    expect(html).not.toContain(">loading<");
  }, 60_000);

  test.each(["dark", "light"] as const)(
    "the browser archives the page with the snapshot's color scheme (%s)",
    async (scheme) => {
      const url = `${baseUrl}/scheme`;
      const id = await createSnapshot(db, url, { colorScheme: scheme });
      await runPipeline(db, id, url, testDir);

      const dom = (await results(id)).find((r) => r.extractor === "dom-snapshot");
      if (dom?.error) return; // No Chromium on this machine.
      const html = readFileSync(dom?.content ?? "", "utf8");
      expect(html).toContain(`scheme:${scheme}`);
    },
    60_000,
  );

  test("a snapshot without a scheme uses WEBFROST_COLOR_SCHEME", async () => {
    process.env.WEBFROST_COLOR_SCHEME = "dark";
    try {
      const url = `${baseUrl}/scheme`;
      const id = await createSnapshot(db, url);
      await runPipeline(db, id, url, testDir);
      const dom = (await results(id)).find((r) => r.extractor === "dom-snapshot");
      if (dom?.error) return;
      expect(readFileSync(dom?.content ?? "", "utf8")).toContain("scheme:dark");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_COLOR_SCHEME");
    }
  }, 60_000);

  test("scrolls through the page first, so sections revealed on scroll are archived visible", async () => {
    const url = `${baseUrl}/reveal`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    const dom = (await results(id)).find((r) => r.extractor === "dom-snapshot");
    if (dom?.error) return; // No Chromium on this machine: covered where there is one (CI).
    const html = readFileSync(dom?.content ?? "", "utf8");
    expect(html).toContain('class="r in"');
    expect(html).toContain('src="/late.json"');
  }, 60_000);

  test("marks the snapshot failed when the page cannot be fetched", async () => {
    const url = `${baseUrl}/missing`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    expect(await statusOf(id)).toBe("failed");
    expect((await db.get<{ status: string }>(sql`SELECT status FROM job_queue`))?.status).toBe(
      "failed",
    );
    expect(await results(id)).toHaveLength(0);
  });

  test("refuses private addresses unless explicitly allowed", async () => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "false";
    try {
      const url = `${baseUrl}/article`;
      const id = await createSnapshot(db, url);
      await runPipeline(db, id, url, testDir);
      expect(await statusOf(id)).toBe("failed");
    } finally {
      process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    }
  });
});

describe("runPipeline: content and cancellation", () => {
  test("a binary URL goes to the WARC byte for byte; html and readability do not run", async () => {
    const url = `${baseUrl}/report.pdf`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);

    const rows = await results(id);
    expect(rows.some((r) => r.extractor === "html" || r.extractor === "readability")).toBe(false);
    const warc = rows.find((r) => r.extractor === "warc");
    expect(warc?.error).toBeNull();
    const bytes = new Uint8Array(readFileSync(warc?.content ?? ""));
    expect(Buffer.from(bytes).includes(Buffer.from(PDF_BYTES))).toBe(true);
    expect(await statusOf(id)).toBe("done");
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
      const id = await createSnapshot(db, url);
      const start = Date.now();
      await runPipeline(db, id, url, testDir);
      expect(Date.now() - start).toBeLessThan(30_000);
      expect((await results(id)).some((r) => r.extractor === "media")).toBe(false);

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
    const callerDb = await openDb(testDir);
    const id = await runner.add(callerDb, `${baseUrl}/article`);
    await callerDb.close();

    await runner.onIdle();

    expect(await statusOf(id)).toBe("done");
    expect(runner.size).toBe(0);
  }, 60_000);

  test("retry answers missing for an unknown id and busy for a snapshot still pending", async () => {
    const runner = new JobRunner({ dir: testDir });
    expect(await runner.retry(db, 9999)).toBe("missing");

    const id = await createSnapshot(db, `${baseUrl}/article`);
    expect(await runner.retry(db, id)).toBe("busy");
    expect(await statusOf(id)).toBe("pending");
    expect(runner.size).toBe(0);
  });

  test("retry archives a done snapshot again in place: results replaced, new lease, scheme kept", async () => {
    const url = `${baseUrl}/article`;
    const id = await createSnapshot(db, url, { colorScheme: "dark" });
    await runPipeline(db, id, url, testDir);
    expect(await statusOf(id)).toBe("done");
    await db.run(sql`UPDATE archive_results SET content = 'stale' WHERE extractor = 'html'`);
    await db.run(sql`UPDATE job_queue SET attempts = 2 WHERE snapshot_id = ${id}`);
    const before = await db.get<{ lease_token: string }>(
      sql`SELECT lease_token FROM job_queue WHERE snapshot_id = ${id}`,
    );

    const runner = new JobRunner({ dir: testDir });
    expect(await runner.retry(db, id)).toBe("queued");

    // Right away: pending, old results gone, new lease, attempts reset.
    expect(await statusOf(id)).toBe("pending");
    expect(await results(id)).toHaveLength(0);
    const job = await db.get<{ status: string; lease_token: string; attempts: number }>(
      sql`SELECT status, lease_token, attempts FROM job_queue WHERE snapshot_id = ${id}`,
    );
    expect(job?.lease_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(job?.lease_token).not.toBe(before?.lease_token);
    expect(Number(job?.attempts)).toBe(0);
    // A second retry while it runs is refused.
    expect(await runner.retry(db, id)).toBe("busy");

    await runner.onIdle();

    expect(await statusOf(id)).toBe("done");
    expect(
      (
        await db.get<{ status: string }>(
          sql`SELECT status FROM job_queue WHERE snapshot_id = ${id}`,
        )
      )?.status,
    ).toBe("done");
    const rows = await results(id);
    const names = rows.map((r) => r.extractor);
    expect(new Set(names).size).toBe(names.length); // one row per extractor
    const html = rows.find((r) => r.extractor === "html");
    expect(html?.content).toContain("Frost Report");
    expect(html?.content).not.toBe("stale");
    expect(
      (
        await db.get<{ color_scheme: string | null; url: string }>(
          sql`SELECT color_scheme, url FROM snapshots WHERE id = ${id}`,
        )
      )?.color_scheme,
    ).toBe("dark");
  }, 60_000);

  test("retry brings a failed snapshot back", async () => {
    const url = `${baseUrl}/missing`;
    const id = await createSnapshot(db, url);
    await runPipeline(db, id, url, testDir);
    expect(await statusOf(id)).toBe("failed");

    const runner = new JobRunner({ dir: testDir });
    expect(await runner.retry(db, id)).toBe("queued");
    expect(await statusOf(id)).toBe("pending");
    await runner.onIdle();
    expect(await statusOf(id)).toBe("failed");
  }, 60_000);

  test("recoverPending re-runs orphaned snapshots without duplicating results", async () => {
    const url = `${baseUrl}/article`;
    const id = await createSnapshot(db, url);
    // Simulate a process that died mid-pipeline: job running, heartbeat long gone,
    // one result already stored.
    await db.run(
      sql`UPDATE job_queue SET status = 'running', heartbeat_at = ${db.ago(600)} WHERE snapshot_id = ${id}`,
    );
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, 'html', 'stale')`,
    );

    const runner = new JobRunner({ dir: testDir });
    expect(await runner.recoverPending()).toBe(1);
    await runner.onIdle();

    expect(await statusOf(id)).toBe("done");
    const html = (await results(id)).filter((r) => r.extractor === "html");
    expect(html).toHaveLength(1);
    expect(html[0]?.content).toContain("Frost Report");
  }, 60_000);

  test("recoverPending leaves a job alone while another process is still working on it", async () => {
    // Another process (a CLI worker next to the server, say) created this snapshot
    // and is running it: its heartbeat is fresh.
    const id = await createSnapshot(db, `${baseUrl}/article`);
    await db.run(sql`UPDATE job_queue SET status = 'running' WHERE snapshot_id = ${id}`);
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, 'html', 'in progress')`,
    );

    expect(await new JobRunner({ dir: testDir }).recoverPending()).toBe(0);

    // Nothing of the live run was thrown away.
    expect(await results(id)).toHaveLength(1);
    expect(await statusOf(id)).toBe("pending");
  });

  test("recoverPending adopts an orphan only once", async () => {
    const id = await createSnapshot(db, `${baseUrl}/article`);
    await db.run(sql`UPDATE job_queue SET heartbeat_at = ${db.ago(600)} WHERE snapshot_id = ${id}`);

    const first = new JobRunner({ dir: testDir });
    const second = new JobRunner({ dir: testDir });
    expect(await first.recoverPending()).toBe(1);
    // The first runner's adoption renewed the lease.
    expect(await second.recoverPending()).toBe(0);
    expect(await first.recoverPending()).toBe(0);

    await first.onIdle();
    expect(await statusOf(id)).toBe("done");
    expect((await results(id)).filter((r) => r.extractor === "html")).toHaveLength(1);
  }, 60_000);

  test("recoverPending gives up on a job that keeps getting interrupted", async () => {
    const id = await createSnapshot(db, `${baseUrl}/article`);
    await db.run(
      sql`UPDATE job_queue SET attempts = 3, heartbeat_at = ${db.ago(600)} WHERE snapshot_id = ${id}`,
    );

    expect(await new JobRunner({ dir: testDir }).recoverPending()).toBe(0);
    expect(await statusOf(id)).toBe("failed");
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
      // Create the snapshots first, in order, so the enqueue order below is deterministic.
      const jobs: { label: string; id: number; url: string }[] = [];
      for (const [label, url] of [
        ["a1", `${slowHost}/1`],
        ["a2", `${slowHost}/2`],
        ["a3", `${slowHost}/3`],
        ["b1", `${otherHost}/1`],
      ] as const) {
        jobs.push({ label, url, id: await createSnapshot(db, url) });
      }

      await Promise.all(
        jobs.map(({ label, id, url }) => runner.enqueue(id, url).then(() => finished.push(label))),
      );

      // b1 was queued last but only had to wait for a1, not for the whole throttled burst.
      expect(finished.indexOf("b1")).toBeLessThan(finished.indexOf("a2"));
      expect(finished.indexOf("a2")).toBeLessThan(finished.indexOf("a3"));
    } finally {
      process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
    }
  });

  test("recoverPending ignores finished snapshots", async () => {
    const id = await createSnapshot(db, `${baseUrl}/article`);
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`);
    expect(await new JobRunner({ dir: testDir }).recoverPending()).toBe(0);
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
      for (let i = 0; i < 6; i++) await runner.add(db, `http://127.0.0.1:${slow.port}/p${i}`);
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
