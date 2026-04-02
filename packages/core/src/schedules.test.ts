import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import {
  addSchedule,
  getDueSchedules,
  listSchedules,
  markScheduleRun,
  removeSchedule,
} from "./schedules";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `schedules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("addSchedule", () => {
  test("returns a positive integer id", () => {
    const id = addSchedule(db, "https://example.com", "*/5 * * * *");
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  test("throws on invalid cron expression", () => {
    expect(() => addSchedule(db, "https://example.com", "not-a-cron")).toThrow();
  });

  test("persists url and cron", () => {
    addSchedule(db, "https://example.com/feed", "0 12 * * *");
    const schedules = listSchedules(db);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.url).toBe("https://example.com/feed");
    expect(schedules[0]?.cron).toBe("0 12 * * *");
  });

  test("next_run_at is set in the future", () => {
    addSchedule(db, "https://example.com", "*/5 * * * *");
    const schedules = listSchedules(db);
    const nextRun = new Date(`${schedules[0]?.next_run_at.replace(" ", "T")}Z`);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("listSchedules", () => {
  test("returns empty array when no schedules", () => {
    expect(listSchedules(db)).toHaveLength(0);
  });

  test("returns all schedules in insertion order", () => {
    addSchedule(db, "https://a.com", "* * * * *");
    addSchedule(db, "https://b.com", "0 9 * * *");
    const list = listSchedules(db);
    expect(list).toHaveLength(2);
    expect(list[0]?.url).toBe("https://a.com");
    expect(list[1]?.url).toBe("https://b.com");
  });
});

describe("removeSchedule", () => {
  test("returns true and removes schedule", () => {
    const id = addSchedule(db, "https://example.com", "* * * * *");
    expect(removeSchedule(db, id)).toBe(true);
    expect(listSchedules(db)).toHaveLength(0);
  });

  test("returns false for non-existent id", () => {
    expect(removeSchedule(db, 9999)).toBe(false);
  });
});

describe("getDueSchedules", () => {
  test("returns schedules with next_run_at in the past", () => {
    const id = addSchedule(db, "https://example.com", "* * * * *");
    // Manually set next_run_at to the past
    db.query("UPDATE schedules SET next_run_at = '2020-01-01 00:00:00' WHERE id = ?").run(id);
    const due = getDueSchedules(db);
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe(id);
  });

  test("does not return schedules with next_run_at in the future", () => {
    addSchedule(db, "https://example.com", "* * * * *");
    // next_run_at is set to next minute (future) by addSchedule
    const due = getDueSchedules(db);
    expect(due).toHaveLength(0);
  });
});

describe("markScheduleRun", () => {
  test("updates last_run_at and sets next_run_at to a future time", () => {
    const id = addSchedule(db, "https://example.com", "*/5 * * * *");

    // Force next_run_at to a known past time to make the delta observable
    db.query("UPDATE schedules SET next_run_at = '2020-01-01 00:00:00' WHERE id = ?").run(id);

    markScheduleRun(db, id, "*/5 * * * *");

    const afterList = listSchedules(db);
    expect(afterList[0]?.last_run_at).not.toBeNull();

    // next_run_at should now be well past 2020-01-01
    const nextRun = new Date(`${afterList[0]?.next_run_at.replace(" ", "T")}Z`);
    expect(nextRun.getTime()).toBeGreaterThan(new Date("2020-01-02").getTime());
  });
});
