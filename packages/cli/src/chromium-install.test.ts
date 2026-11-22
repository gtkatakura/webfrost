import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { headlessShellVersion } from "./chromium-build";
import { unpack } from "./chromium-install";

describe("headless shell version", () => {
  test("comes from the installed playwright-core", () => {
    expect(headlessShellVersion()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("unpack", () => {
  test("extracts files and makes them executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "webfrost-unpack-"));
    try {
      const zip = zipSync({
        "chrome-headless-shell-linux64/chrome-headless-shell": new TextEncoder().encode("bin"),
      });
      unpack(zip, dir);
      const file = join(dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
      expect(readFileSync(file, "utf8")).toBe("bin");
      expect(statSync(file).mode & 0o111).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses entries that would land outside the target folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "webfrost-unpack-"));
    try {
      const zip = zipSync({ "../escape.txt": new TextEncoder().encode("x") });
      expect(() => unpack(zip, dir)).toThrow(/outside/);
      expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
