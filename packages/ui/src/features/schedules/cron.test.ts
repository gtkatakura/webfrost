import { describe, expect, test } from "bun:test";
import { describeCron } from "./cron";

describe("describeCron", () => {
  test("names the presets", () => {
    expect(describeCron("0 * * * *")).toBe("Hourly");
    expect(describeCron("0 0 * * *")).toBe("Daily");
    expect(describeCron("0 0 * * 0")).toBe("Weekly");
  });

  test("describes a fixed time every day or every hour", () => {
    expect(describeCron("0 6 * * *")).toBe("Daily at 06:00");
    expect(describeCron("30 18 * * *")).toBe("Daily at 18:30");
    expect(describeCron("15 * * * *")).toBe("Hourly at :15");
  });

  test("returns anything else as written", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("0 9 * * 1-5");
    expect(describeCron("*/5 * * * *")).toBe("*/5 * * * *");
    expect(describeCron("0 25 * * *")).toBe("0 25 * * *");
    expect(describeCron("nonsense")).toBe("nonsense");
  });
});
