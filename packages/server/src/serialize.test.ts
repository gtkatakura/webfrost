import { describe, expect, test } from "bun:test";
import { isoTimestamp, pageParams, paginate, parseIsoTimestamp } from "./serialize";
import { successorPath } from "./version";

describe("isoTimestamp", () => {
  test("turns the stored form into ISO 8601 UTC with a Z", () => {
    expect(isoTimestamp("2026-11-21 21:42:38")).toBe("2026-11-21T21:42:38Z");
  });

  test("normalises values that are already ISO, dropping fractions and offsets of zero", () => {
    expect(isoTimestamp("2026-11-21T21:42:38.123Z")).toBe("2026-11-21T21:42:38Z");
    expect(isoTimestamp("2026-11-21T21:42:38+00:00")).toBe("2026-11-21T21:42:38Z");
    expect(isoTimestamp("2026-11-21T23:42:38+02:00")).toBe("2026-11-21T21:42:38Z");
  });

  test("keeps null as null", () => {
    expect(isoTimestamp(null)).toBeNull();
    expect(isoTimestamp(undefined)).toBeNull();
  });
});

describe("parseIsoTimestamp", () => {
  test("accepts ISO 8601 input and returns the stored form in UTC", () => {
    expect(parseIsoTimestamp("2027-01-02T03:04:05Z")).toBe("2027-01-02 03:04:05");
    expect(parseIsoTimestamp("2027-01-02T05:04:05+02:00")).toBe("2027-01-02 03:04:05");
    expect(parseIsoTimestamp("2027-01-02")).toBe("2027-01-02 00:00:00");
    // No offset: read as UTC, never as the server's local time.
    expect(parseIsoTimestamp("2027-01-02T03:04")).toBe("2027-01-02 03:04:00");
  });

  test("rejects anything that is not an ISO timestamp", () => {
    for (const value of ["tomorrow", "1700000000", "01/02/2027", "2027-13-40T00:00:00Z"]) {
      expect(parseIsoTimestamp(value)).toBeNull();
    }
  });
});

describe("pagination", () => {
  test("defaults to page 1 of 20 and caps the limit at 200", () => {
    expect(pageParams({})).toEqual({ page: 1, limit: 20 });
    expect(pageParams({ page: "3", limit: "1000" })).toEqual({ page: 3, limit: 200 });
    expect(pageParams({ page: "-2", limit: "2.9" })).toEqual({ page: 1, limit: 2 });
  });

  test("slices an in-memory list into the envelope", () => {
    const all = [1, 2, 3, 4, 5];
    expect(paginate(all, { page: "2", limit: "2" })).toEqual({
      items: [3, 4],
      total: 5,
      page: 2,
      limit: 2,
    });
    expect(paginate(all, { page: "9", limit: "2" }).items).toEqual([]);
  });
});

describe("successorPath", () => {
  test("maps the deprecated /api alias to /api/v1", () => {
    expect(successorPath("/api/snapshots/1")).toBe("/api/v1/snapshots/1");
  });

  test("is null for v1 paths and anything outside the API", () => {
    for (const path of ["/api/v1/snapshots", "/api/v1", "/api", "/health", "/apix/snapshots"]) {
      expect(successorPath(path)).toBeNull();
    }
  });
});
