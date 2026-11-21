import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import {
  addSchedule,
  getDueSchedules,
  getSchedule,
  listSchedules,
  markScheduleRun,
  pauseSchedule,
  removeSchedule,
  updateScheduleStatus,
} from "./schedules";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `schedules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("addSchedule", () => {
  test("returns a positive integer id", async () => {
    const id = await addSchedule(db, "https://example.com", "*/5 * * * *");
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  test("throws on invalid cron expression", async () => {
    await expect(addSchedule(db, "https://example.com", "not-a-cron")).rejects.toThrow();
  });

  test("persists url and cron", async () => {
    await addSchedule(db, "https://example.com/feed", "0 12 * * *");
    const schedules = await listSchedules(db);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.url).toBe("https://example.com/feed");
    expect(schedules[0]?.cron).toBe("0 12 * * *");
  });

  test("next_run_at is set in the future", async () => {
    await addSchedule(db, "https://example.com", "*/5 * * * *");
    const schedules = await listSchedules(db);
    const nextRun = new Date(`${schedules[0]?.next_run_at.replace(" ", "T")}Z`);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("listSchedules", () => {
  test("returns empty array when no schedules", async () => {
    expect(await listSchedules(db)).toHaveLength(0);
  });

  test("returns all schedules in insertion order", async () => {
    await addSchedule(db, "https://a.com", "* * * * *");
    await addSchedule(db, "https://b.com", "0 9 * * *");
    const list = await listSchedules(db);
    expect(list).toHaveLength(2);
    expect(list[0]?.url).toBe("https://a.com");
    expect(list[1]?.url).toBe("https://b.com");
  });
});

describe("removeSchedule", () => {
  test("returns true and removes schedule", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    expect(await removeSchedule(db, id)).toBe(true);
    expect(await listSchedules(db)).toHaveLength(0);
  });

  test("returns false for non-existent id", async () => {
    expect(await removeSchedule(db, 9999)).toBe(false);
  });
});

describe("getDueSchedules", () => {
  test("returns schedules with next_run_at in the past", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    // Manually set next_run_at to the past
    await db.run(sql`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00' WHERE id = ${id}`);
    const due = await getDueSchedules(db);
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe(id);
  });

  test("does not return schedules with next_run_at in the future", async () => {
    await addSchedule(db, "https://example.com", "* * * * *");
    // next_run_at is set to next minute (future) by addSchedule
    const due = await getDueSchedules(db);
    expect(due).toHaveLength(0);
  });

  test("does not return paused schedules", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await db.run(
      sql`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00', paused = 1 WHERE id = ${id}`,
    );
    expect(await getDueSchedules(db)).toHaveLength(0);
  });
});

describe("pauseSchedule", () => {
  test("pauses a schedule and removes it from due", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await db.run(sql`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00' WHERE id = ${id}`);
    expect(await pauseSchedule(db, id, true)).toBe(true);
    expect(await getDueSchedules(db)).toHaveLength(0);
    expect((await getSchedule(db, id))?.paused).toBe(1);
  });

  test("resumes a paused schedule", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await db.run(
      sql`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00', paused = 1 WHERE id = ${id}`,
    );
    await pauseSchedule(db, id, false);
    expect(await getDueSchedules(db)).toHaveLength(1);
    expect((await getSchedule(db, id))?.paused).toBe(0);
  });

  test("returns false for non-existent id", async () => {
    expect(await pauseSchedule(db, 9999, true)).toBe(false);
  });
});

describe("updateScheduleStatus", () => {
  test("sets last_status to success and resets consecutive_failures", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await db.run(
      sql`UPDATE schedules SET consecutive_failures = 3, last_status = 'failed' WHERE id = ${id}`,
    );
    await updateScheduleStatus(db, id, "success");
    const s = await getSchedule(db, id);
    expect(s?.last_status).toBe("success");
    expect(s?.consecutive_failures).toBe(0);
  });

  test("sets last_status to failed and increments consecutive_failures", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await updateScheduleStatus(db, id, "failed");
    await updateScheduleStatus(db, id, "failed");
    const s = await getSchedule(db, id);
    expect(s?.last_status).toBe("failed");
    expect(s?.consecutive_failures).toBe(2);
  });

  test("success after failures resets counter", async () => {
    const id = await addSchedule(db, "https://example.com", "* * * * *");
    await updateScheduleStatus(db, id, "failed");
    await updateScheduleStatus(db, id, "failed");
    await updateScheduleStatus(db, id, "success");
    const s = await getSchedule(db, id);
    expect(s?.consecutive_failures).toBe(0);
  });
});

describe("getSchedule", () => {
  test("returns null for non-existent id", async () => {
    expect(await getSchedule(db, 9999)).toBeNull();
  });

  test("returns schedule with new fields", async () => {
    const id = await addSchedule(db, "https://example.com", "*/5 * * * *");
    const s = await getSchedule(db, id);
    expect(s?.paused).toBe(0);
    expect(s?.last_status).toBeNull();
    expect(s?.consecutive_failures).toBe(0);
  });
});

describe("markScheduleRun", () => {
  test("updates last_run_at and sets next_run_at to a future time", async () => {
    const id = await addSchedule(db, "https://example.com", "*/5 * * * *");

    // Force next_run_at to a known past time to make the delta observable
    await db.run(sql`UPDATE schedules SET next_run_at = '2020-01-01 00:00:00' WHERE id = ${id}`);

    await markScheduleRun(db, id, "*/5 * * * *");

    const afterList = await listSchedules(db);
    expect(afterList[0]?.last_run_at).not.toBeNull();

    // next_run_at should now be well past 2020-01-01
    const nextRun = new Date(`${afterList[0]?.next_run_at.replace(" ", "T")}Z`);
    expect(nextRun.getTime()).toBeGreaterThan(new Date("2020-01-02").getTime());
  });
});
