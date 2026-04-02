import { describe, expect, test } from "bun:test";
import { nextCronDate, parseCron } from "./cron";

describe("parseCron", () => {
  test("parses wildcard fields", () => {
    const parsed = parseCron("* * * * *");
    expect(parsed.minutes.has(0)).toBe(true);
    expect(parsed.minutes.has(59)).toBe(true);
    expect(parsed.hours.has(23)).toBe(true);
    expect(parsed.doms.has(1)).toBe(true);
    expect(parsed.doms.has(31)).toBe(true);
    expect(parsed.months.has(12)).toBe(true);
    expect(parsed.dows.has(6)).toBe(true);
  });

  test("parses step values", () => {
    const parsed = parseCron("*/5 */2 * * *");
    expect([...parsed.minutes]).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect([...parsed.hours]).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  test("parses literal values", () => {
    const parsed = parseCron("30 14 15 3 1");
    expect(parsed.minutes.has(30)).toBe(true);
    expect(parsed.minutes.size).toBe(1);
    expect(parsed.hours.has(14)).toBe(true);
    expect(parsed.doms.has(15)).toBe(true);
    expect(parsed.months.has(3)).toBe(true);
    expect(parsed.dows.has(1)).toBe(true);
  });

  test("parses ranges", () => {
    const parsed = parseCron("0 9-17 * * *");
    expect([...parsed.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  test("parses comma-separated lists", () => {
    const parsed = parseCron("0,30 * * * *");
    expect(parsed.minutes.has(0)).toBe(true);
    expect(parsed.minutes.has(30)).toBe(true);
    expect(parsed.minutes.size).toBe(2);
  });

  test("throws on wrong field count", () => {
    expect(() => parseCron("* * *")).toThrow("5 fields");
    expect(() => parseCron("* * * * * *")).toThrow("5 fields");
  });
});

describe("nextCronDate", () => {
  test("returns the very next minute for '* * * * *'", () => {
    const from = new Date("2026-04-01T12:00:00.000Z");
    const next = nextCronDate("* * * * *", from);
    const expected = new Date("2026-04-01T12:01:00.000Z");
    expect(next.toISOString()).toBe(expected.toISOString());
  });

  test("finds next matching minute for */5 * * * *", () => {
    const from = new Date("2026-04-01T12:03:00.000Z");
    const next = nextCronDate("*/5 * * * *", from);
    // next multiple of 5 minutes after :03 is :05
    expect(next.getMinutes()).toBe(5);
  });

  test("finds correct hour for 0 9 * * *", () => {
    const from = new Date("2026-04-01T08:00:00.000Z");
    const next = nextCronDate("0 9 * * *", from);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  test("advances to next day if daily job already ran today", () => {
    const from = new Date("2026-04-01T10:00:00.000Z");
    const next = nextCronDate("0 9 * * *", from);
    // 9am has passed — next is 9am tomorrow
    const fromDate = from.getDate();
    expect(next.getDate()).not.toBe(fromDate);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });
});
