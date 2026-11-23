import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import { JobRunner } from "./jobs";
import { claimSchedule, runDueSchedules } from "./scheduler";
import { addSchedule, getDueSchedules, getSchedule, pauseSchedule } from "./schedules";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let testDir: string;
let db: Db;
const savedEnv: Record<string, string | undefined> = {};

const FEED = (origin: string) => `<?xml version="1.0"?><rss version="2.0"><channel>
<item><link>${origin}/a</link></item><item><link>${origin}/b</link></item>
</channel></rss>`;

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname, origin } = new URL(req.url);
      if (pathname === "/feed.xml") return new Response(FEED(origin));
      if (pathname === "/huge-feed.xml") {
        const items = [1, 2, 3, 4].map((i) => `<item><link>${origin}/h${i}</link></item>`);
        return new Response(`<rss>${items.join("")}</rss>`);
      }
      if (pathname === "/down") return new Response("no", { status: 500 });
      return new Response("<html><body><p>hello</p></body></html>", {
        headers: { "content-type": "text/html" },
      });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
  for (const key of ["WEBFROST_ALLOW_PRIVATE_URLS", "WEBFROST_DOMAIN_DELAY_MS"]) {
    savedEnv[key] = process.env[key];
  }
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
  testDir = join(tmpdir(), `scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

/** Make a schedule due by moving its next run into the past. */
async function makeDue(id: number) {
  await db.run(sql`UPDATE schedules SET next_run_at = '2000-01-01 00:00:00' WHERE id = ${id}`);
}

function snapshots() {
  return db.all<{ url: string; status: string }>(
    sql`SELECT url, status FROM snapshots ORDER BY id`,
  );
}

describe("claimSchedule", () => {
  test("only the first claim of a due schedule wins", async () => {
    const id = await addSchedule(db, `${baseUrl}/page`, "*/5 * * * *");
    await makeDue(id);
    const [due] = await getDueSchedules(db);
    if (!due) throw new Error("expected a due schedule");

    expect(await claimSchedule(db, due)).toBe(true);
    // A second worker that read the same row before the first one claimed it:
    expect(await claimSchedule(db, due)).toBe(false);

    const after = await getSchedule(db, id);
    expect(after?.last_run_at).not.toBeNull();
    expect(await getDueSchedules(db)).toHaveLength(0);
  });

  test("does not claim a schedule paused after it was read", async () => {
    const id = await addSchedule(db, `${baseUrl}/page`, "*/5 * * * *");
    await makeDue(id);
    const [due] = await getDueSchedules(db);
    if (!due) throw new Error("expected a due schedule");
    await pauseSchedule(db, id, true);
    expect(await claimSchedule(db, due)).toBe(false);
  });
});

describe("runDueSchedules", () => {
  test("archives a due URL schedule and records success", async () => {
    const id = await addSchedule(db, `${baseUrl}/page`, "*/5 * * * *");
    await makeDue(id);
    const runner = new JobRunner({ dir: testDir });

    expect(await runDueSchedules({ dir: testDir, runner })).toBe(1);

    expect(await snapshots()).toEqual([{ url: `${baseUrl}/page`, status: "done" }]);
    const schedule = await getSchedule(db, id);
    expect(schedule?.last_status).toBe("success");
    expect(schedule?.consecutive_failures).toBe(0);
    expect(new Date(`${schedule?.next_run_at.replace(" ", "T")}Z`).getTime()).toBeGreaterThan(
      Date.now(),
    );
  }, 60_000);

  test("records a failure when the archive fails", async () => {
    const id = await addSchedule(db, `${baseUrl}/down`, "*/5 * * * *");
    await makeDue(id);

    await runDueSchedules({ dir: testDir, runner: new JobRunner({ dir: testDir }) });

    expect(await snapshots()).toEqual([{ url: `${baseUrl}/down`, status: "failed" }]);
    const schedule = await getSchedule(db, id);
    expect(schedule?.last_status).toBe("failed");
    expect(schedule?.consecutive_failures).toBe(1);
  });

  test("skips schedules that are not due or are paused", async () => {
    await addSchedule(db, `${baseUrl}/later`, "*/5 * * * *");
    const paused = await addSchedule(db, `${baseUrl}/paused`, "*/5 * * * *");
    await makeDue(paused);
    await pauseSchedule(db, paused, true);

    const ran = await runDueSchedules({ dir: testDir, runner: new JobRunner({ dir: testDir }) });

    expect(ran).toBe(0);
    expect(await snapshots()).toHaveLength(0);
  });

  test("overlapping passes run a due schedule once", async () => {
    const id = await addSchedule(db, `${baseUrl}/page`, "*/5 * * * *");
    await makeDue(id);
    const runner = new JobRunner({ dir: testDir });

    const [first, second] = await Promise.all([
      runDueSchedules({ dir: testDir, runner }),
      runDueSchedules({ dir: testDir, runner }),
    ]);

    expect(first + second).toBe(1);
    expect(await snapshots()).toHaveLength(1);
  }, 60_000);

  test("an RSS schedule archives new feed items and skips known ones", async () => {
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES (${`${baseUrl}/a`}, 'done')`);
    const id = await addSchedule(db, `${baseUrl}/feed.xml`, "*/5 * * * *", "rss_feed");
    await makeDue(id);

    await runDueSchedules({ dir: testDir, runner: new JobRunner({ dir: testDir }) });

    expect((await snapshots()).map((s) => s.url)).toEqual([`${baseUrl}/a`, `${baseUrl}/b`]);
    expect((await getSchedule(db, id))?.last_status).toBe("success");
  }, 60_000);
});

describe("scheduler robustness", () => {
  test("an RSS feed over WEBFROST_IMPORT_MAX_URLS fails the run and queues nothing", async () => {
    process.env.WEBFROST_IMPORT_MAX_URLS = "3";
    try {
      const id = await addSchedule(db, `${baseUrl}/huge-feed.xml`, "*/5 * * * *", "rss_feed");
      await makeDue(id);
      await runDueSchedules({ dir: testDir, runner: new JobRunner({ dir: testDir }) });
      expect(await snapshots()).toHaveLength(0);
      expect((await getSchedule(db, id))?.last_status).toBe("failed");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_IMPORT_MAX_URLS");
    }
  }, 60_000);

  test("a schedule whose cron no longer parses does not block the others", async () => {
    const good = await addSchedule(db, `${baseUrl}/page`, "*/5 * * * *");
    const broken = await addSchedule(db, `${baseUrl}/broken`, "*/5 * * * *");
    await db.run(sql`UPDATE schedules SET cron = 'not a cron' WHERE id = ${broken}`);
    await makeDue(good);
    await makeDue(broken);

    const ran = await runDueSchedules({ dir: testDir, runner: new JobRunner({ dir: testDir }) });

    expect(ran).toBe(1);
    expect((await snapshots()).map((s) => s.url)).toEqual([`${baseUrl}/page`]);
    expect((await getSchedule(db, good))?.last_status).toBe("success");
  }, 60_000);

  test("a run that outlasts its period is not started again on top of itself", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = Bun.serve({
      port: 0,
      async fetch() {
        await gate;
        return new Response("gone", { status: 404 });
      },
    });
    try {
      const id = await addSchedule(db, `http://127.0.0.1:${slow.port}/slow`, "* * * * *");
      await makeDue(id);
      const runner = new JobRunner({ dir: testDir });

      const firstRun = runDueSchedules({ dir: testDir, runner });
      await Bun.sleep(100);
      // The next slot comes due while the first run is still going.
      await makeDue(id);
      expect(await runDueSchedules({ dir: testDir, runner })).toBe(0);
      expect(await snapshots()).toHaveLength(1);

      release();
      expect(await firstRun).toBe(1);
      // Once it has finished, the slot that came due in the meantime runs.
      expect(await runDueSchedules({ dir: testDir, runner })).toBe(1);
      expect(await snapshots()).toHaveLength(2);
    } finally {
      release();
      slow.stop(true);
    }
  }, 60_000);
});
