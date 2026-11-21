import { describe, expect, test } from "bun:test";
import { normalizeUrl, parsePositiveInt } from "./url";

describe("normalizeUrl", () => {
  test("prepends https:// to a bare domain", () => {
    expect(normalizeUrl("example.com")).toEqual({ ok: true, url: "https://example.com/" });
    expect(normalizeUrl("  example.com/path?q=1 ")).toEqual({
      ok: true,
      url: "https://example.com/path?q=1",
    });
  });

  test("keeps an explicit http or https scheme", () => {
    expect(normalizeUrl("http://example.com")).toEqual({ ok: true, url: "http://example.com/" });
    expect(normalizeUrl("https://example.com/a")).toEqual({
      ok: true,
      url: "https://example.com/a",
    });
  });

  test("rejects empty input, spaces and non-web schemes with a message", () => {
    for (const bad of ["", "   ", "not a url", "ftp://example.com", "javascript://x"]) {
      const result = normalizeUrl(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe("parsePositiveInt", () => {
  test("accepts positive integers only", () => {
    expect(parsePositiveInt("5")).toBe(5);
    for (const bad of ["abc", "0", "-1", "1.5", "", null, undefined, "12abc"]) {
      expect(parsePositiveInt(bad)).toBeNull();
    }
  });
});
