import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRunLog } from "./run-log";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webfrost-run-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("openRunLog", () => {
  test("creates logs/ and names the file after the command and the start time", () => {
    const log = openRunLog(dir, "rescue", new Date("2026-11-24T05:40:12.345Z"));
    expect(log.path).toBe(join(dir, "logs", "rescue-2026-11-24T05-40-12Z.jsonl"));
    log.write("start", "rescue blocked", { total: 3 });
    expect(readdirSync(join(dir, "logs"))).toEqual(["rescue-2026-11-24T05-40-12Z.jsonl"]);
    expect(log.problem).toBeUndefined();
  });

  test("each entry is on disk as soon as it is written, one JSON object per line", () => {
    const log = openRunLog(dir, "rescue");
    log.write("page", "rescued: https://example.com/a", { n: 1, outcome: "rescued", remoteId: 7 });
    // Read back before anything else is written or closed: a killed run keeps what it logged.
    expect(lines(log.path)).toHaveLength(1);
    log.write("page", "really gone: https://example.com/b", { n: 2, outcome: "gone" });

    const [first, second] = lines(log.path);
    expect(first).toMatchObject({
      event: "page",
      msg: "rescued: https://example.com/a",
      n: 1,
      outcome: "rescued",
      remoteId: 7,
    });
    expect(String(first?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(second).toMatchObject({ event: "page", n: 2, outcome: "gone" });
    // One run on one machine: no process id or host name on every line.
    expect(first).not.toHaveProperty("pid");
    expect(first).not.toHaveProperty("hostname");
  });

  test("two runs started in the same second get a file each", () => {
    const at = new Date("2026-11-24T05:40:12Z");
    const first = openRunLog(dir, "rescue", at);
    first.write("start", "first");
    const second = openRunLog(dir, "rescue", at);
    second.write("start", "second");
    expect(second.path).toBe(join(dir, "logs", "rescue-2026-11-24T05-40-12Z-2.jsonl"));
    expect(lines(first.path).map((l) => l.msg)).toEqual(["first"]);
    expect(lines(second.path).map((l) => l.msg)).toEqual(["second"]);
  });

  test("a folder that cannot be written gives a problem to report, never an exception", () => {
    if (process.getuid?.() === 0) return; // root writes anywhere
    const readOnly = join(dir, "read-only");
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o500);
    try {
      const log = openRunLog(readOnly, "rescue");
      expect(log.problem).toBeDefined();
      expect(() => log.write("page", "anything")).not.toThrow();
    } finally {
      chmodSync(readOnly, 0o700);
    }
  });
});
