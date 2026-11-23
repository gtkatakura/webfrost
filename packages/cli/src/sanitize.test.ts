import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabases, createTag, openDb } from "@webfrost/core";
import { runChecks } from "./commands/doctor";
import { safeMessage, safeText } from "./sanitize";

const CLI = join(import.meta.dir, "index.ts");
const ESC = "\u001b";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webfrost-sanitize-"));
});
afterEach(() => {
  try {
    chmodSync(join(dir, "locked"), 0o700);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});

describe("safeText / safeMessage", () => {
  test("strip C0, C1 and ESC, keep printable Unicode", () => {
    expect(safeText(`a${ESC}]52;c;QQ==\u0007b\u009bc d é日本`)).toBe("a]52;c;QQ==bc d é日本");
    expect(safeMessage(`l1\nl2\t${ESC}[2J\r\nl3\rx`)).toBe("l1\nl2\t[2J\r\nl3x");
  });
});

describe("terminal output", () => {
  test("`tag list` never emits ESC or BEL from an untrusted tag name", async () => {
    const db = await openDb(dir);
    await createTag(db, `evil${ESC}]52;c;QQ==\u0007name`);
    await closeDatabases();
    const proc = Bun.spawn([process.execPath, "run", CLI, "tag", "list"], {
      env: { ...process.env, WEBFROST_DIR: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const out = stdout + stderr;
    expect(out).toContain("evil]52;c;QQ==name");
    expect(out).not.toContain(ESC);
    expect(out).not.toContain("\u0007");
  });
});

describe("doctor never deletes what it did not create", () => {
  const dirCheck = async (target: string) =>
    (await runChecks({ dir: target })).find((c) => c.name === "Data directory");

  test("a dangling symlink as the data directory survives", async () => {
    const link = join(dir, "archive");
    symlinkSync(join(dir, "unmounted"), link);
    const check = await dirCheck(link);
    expect(check?.level).toBe("fail");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  test("an unsearchable parent is a FAIL line, not an exception", async () => {
    if (process.getuid?.() === 0) return;
    mkdirSync(join(dir, "locked"));
    chmodSync(join(dir, "locked"), 0o000);
    const check = await dirCheck(join(dir, "locked", "data"));
    expect(check?.level).toBe("fail");
  });

  test("a directory it had to create is removed again, existing ones are kept", async () => {
    expect((await dirCheck(join(dir, "a", "b")))?.level).toBe("ok");
    expect(existsSync(join(dir, "a"))).toBe(false);
    mkdirSync(join(dir, "existing"));
    expect((await dirCheck(join(dir, "existing")))?.level).toBe("ok");
    expect(existsSync(join(dir, "existing"))).toBe(true);
  });
});
