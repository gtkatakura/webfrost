import { describe, expect, test } from "bun:test";
import { readableOn } from "./TagChip";

describe("readableOn", () => {
  test("picks the text color with the higher contrast ratio", () => {
    // White on this cyan is 3.7:1; near-black is 5.1:1.
    expect(readableOn("#0891b2")).toBe("#111111");
    expect(readableOn("#1d64d8")).toBe("#ffffff");
    expect(readableOn("#ffd43b")).toBe("#111111");
    expect(readableOn("#000000")).toBe("#ffffff");
  });

  test("falls back to near-black for anything that is not #rrggbb", () => {
    expect(readableOn("red")).toBe("#111111");
    expect(readableOn("#fff")).toBe("#111111");
  });
});
