import { describe, expect, test } from "bun:test";

describe("@webfrost/core", () => {
  test("placeholder — module imports without error", async () => {
    const mod = await import("./index");
    expect(mod).toBeDefined();
  });
});
