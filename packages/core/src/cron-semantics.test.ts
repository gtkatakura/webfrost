import { afterEach, describe, expect, test } from "bun:test";
import { CronError, nextCronDate, parseCron } from "./cron";

describe("parseCron validation", () => {
  test.each([
    ["60 * * * *", "minute"],
    ["* 24 * * *", "hour"],
    ["* * 0 * *", "day-of-month"],
    ["* * 32 * *", "day-of-month"],
    ["* * * 13 *", "month"],
    ["* * * 0 *", "month"],
    ["* * * * 8", "day-of-week"],
    ["5-70 * * * *", "minute"],
    ["10-5 * * * *", "minute"],
    ["*/0 * * * *", "minute"],
    ["1x * * * *", "minute"],
    ["* * * FOO *", "month"],
    ["@nope", "alias"],
  ])("rejects %s naming the %s", (expr, field) => {
    expect(() => parseCron(expr)).toThrow(CronError);
    expect(() => parseCron(expr)).toThrow(field);
  });

  test("error messages contain 'cron' so the API maps them to 400", () => {
    expect(() => parseCron("60 * * * *")).toThrow("cron");
  });

  test("fails fast instead of searching for a date", () => {
    const t = performance.now();
    expect(() => nextCronDate("60 * * * *", new Date())).toThrow("minute");
    expect(performance.now() - t).toBeLessThan(100);
  });

  test("supports ranges with steps and open steps", () => {
    expect([...parseCron("1-10/2 * * * *").minutes]).toEqual([1, 3, 5, 7, 9]);
    expect([...parseCron("50/5 * * * *").minutes]).toEqual([50, 55]);
  });

  test("supports month and weekday names in any case, and 7 as Sunday", () => {
    const p = parseCron("0 0 * jan-MAR,dec mon-Fri");
    expect([...p.months]).toEqual([1, 2, 3, 12]);
    expect([...p.dows]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 0 * * 7").dows]).toEqual([0]);
    expect([...parseCron("0 0 * * 5-7").dows].sort()).toEqual([0, 5, 6]);
    expect([...parseCron("0 0 * * SUN").dows]).toEqual([0]);
  });

  test("supports @ aliases", () => {
    expect([...parseCron("@hourly").minutes]).toEqual([0]);
    expect(parseCron("@hourly").hours.size).toBe(24);
    expect(nextCronDate("@daily", new Date(2026, 0, 5, 10, 0)).getHours()).toBe(0);
    expect(nextCronDate("@weekly", new Date(2026, 0, 5, 10, 0)).getDay()).toBe(0);
    expect(nextCronDate("@monthly", new Date(2026, 0, 5, 10, 0)).getDate()).toBe(1);
    expect(nextCronDate("@yearly", new Date(2026, 0, 5, 10, 0)).getMonth()).toBe(0);
  });
});

describe("day-of-month / day-of-week semantics", () => {
  test("uses OR when both are restricted", () => {
    // 15th of the month OR any Monday. 2026-03-02 is a Monday, before the 15th.
    const next = nextCronDate("0 0 15 * 1", new Date(2026, 2, 1, 12, 0));
    expect(next.getDate()).toBe(2);
    const after = nextCronDate("0 0 15 * 1", new Date(2026, 2, 13, 12, 0));
    expect(after.getDate()).toBe(15); // a Sunday, matched by day-of-month
  });

  test("uses AND when only one is restricted", () => {
    const next = nextCronDate("0 0 * * 1", new Date(2026, 2, 3, 12, 0));
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(9);
    const dom = nextCronDate("0 0 15 * *", new Date(2026, 2, 3, 12, 0));
    expect(dom.getDate()).toBe(15);
  });

  test("a step wildcard counts as unrestricted", () => {
    const next = nextCronDate("0 0 15 * */2", new Date(2026, 0, 1));
    expect(next.getDate()).toBe(15);
    expect([0, 2, 4, 6]).toContain(next.getDay());
  });

  test("a schedule that can never fire throws", () => {
    expect(() => nextCronDate("0 0 31 2 *", new Date(2026, 0, 1))).toThrow(CronError);
  });
});

describe("DST handling (process time zone)", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(process.env, "TZ");
    else process.env.TZ = original;
  });

  test("Europe/Berlin spring forward: the nonexistent 02:30 is skipped that day", () => {
    process.env.TZ = "Europe/Berlin";
    // 2026-03-29 02:00 -> 03:00 local.
    const next = nextCronDate("30 2 * * *", new Date("2026-03-28T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-03-30T00:30:00.000Z"); // 30th 02:30 CEST
  });

  test("Europe/Berlin fall back: 02:30 fires once, on its first occurrence", () => {
    process.env.TZ = "Europe/Berlin";
    // 2026-10-25 03:00 CEST -> 02:00 CET; 02:30 occurs at 00:30Z and 01:30Z.
    const first = nextCronDate("30 2 * * *", new Date("2026-10-24T12:00:00Z"));
    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    const second = nextCronDate("30 2 * * *", first);
    expect(second.toISOString()).toBe("2026-10-26T01:30:00.000Z");
  });

  test("America/New_York: hourly jobs keep firing through spring forward", () => {
    process.env.TZ = "America/New_York";
    // 2026-03-08 02:00 EST -> 03:00 EDT (07:00Z).
    let d = new Date("2026-03-08T05:30:00Z"); // 00:30 EST
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      d = nextCronDate("0 * * * *", d);
      seen.push(d.toISOString());
    }
    expect(seen).toEqual([
      "2026-03-08T06:00:00.000Z", // 01:00 EST
      "2026-03-08T07:00:00.000Z", // 03:00 EDT
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T09:00:00.000Z",
    ]);
  });

  test("America/New_York fall back: a repeated hour fires once", () => {
    process.env.TZ = "America/New_York";
    // 2026-11-01 02:00 EDT -> 01:00 EST; 01:00 occurs at 05:00Z and 06:00Z.
    const a = nextCronDate("0 1 * * *", new Date("2026-11-01T04:45:00Z"));
    expect(a.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    const b = nextCronDate("0 1 * * *", a);
    expect(b.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
});
