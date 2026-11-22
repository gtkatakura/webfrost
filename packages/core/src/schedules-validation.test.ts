import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronError } from "./cron";
import { type Db, openDb } from "./db";
import { addRssFeedSchedule, addSchedule, listSchedules } from "./schedules";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `sched-val-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

// The server maps errors whose message mentions "cron" to HTTP 400, and the CLI
// prints the message, so core throwing a CronError here is what both rely on.
describe("schedule creation validates the cron expression", () => {
  test("addSchedule rejects out-of-range fields and stores nothing", async () => {
    await expect(addSchedule(db, "https://example.com", "60 * * * *")).rejects.toThrow(CronError);
    await expect(addSchedule(db, "https://example.com", "* * * * 9")).rejects.toThrow(
      "day-of-week",
    );
    expect(await listSchedules(db)).toHaveLength(0);
  });

  test("addRssFeedSchedule rejects invalid expressions", async () => {
    await expect(addRssFeedSchedule(db, "https://example.com/feed", "* 25 * * *")).rejects.toThrow(
      /cron.*hour/i,
    );
  });

  test("addSchedule accepts names, steps and aliases", async () => {
    await addSchedule(db, "https://example.com", "0 9 * * MON-FRI");
    await addSchedule(db, "https://example.com", "1-10/2 * * * *");
    await addSchedule(db, "https://example.com", "@daily");
    expect(await listSchedules(db)).toHaveLength(3);
  });
});
