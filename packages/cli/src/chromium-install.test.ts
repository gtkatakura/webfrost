import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { headlessShellVersion } from "./chromium-build";
import {
  browserPackagesHint,
  chromiumLaunches,
  chromiumVersion,
  missingLibraries,
  unpack,
} from "./chromium-install";

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

describe("browser start check", () => {
  test("names the libraries a failed start was missing", () => {
    const stderr =
      "chrome: error while loading shared libraries: libnss3.so: cannot open shared object file\n" +
      "chrome: error while loading shared libraries: libnss3.so: cannot open shared object file\n" +
      "chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file";
    expect(missingLibraries(stderr)).toEqual(["libnss3.so", "libgbm.so.1"]);
    expect(missingLibraries("some other failure")).toEqual([]);
  });

  test("a browser that answers --version but cannot open a page is reported, with what it lacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "webfrost-fake-chrome-"));
    const fake = join(dir, "chrome");
    writeFileSync(
      fake,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Fake 1.0"; exit 0; fi\n' +
        'echo "chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file" >&2\nexit 127\n',
    );
    chmodSync(fake, 0o755);
    try {
      expect(await chromiumVersion(fake)).toEqual({ ok: true, version: "Fake 1.0" });
      const launch = await chromiumLaunches(fake, 10_000);
      expect(launch.ok).toBe(false);
      if (!launch.ok) {
        expect(launch.missing).toEqual(["libgbm.so.1"]);
        expect(launch.reason).toContain("libgbm.so.1");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  const realChromium = process.env.WEBFROST_CHROMIUM_PATH;
  test.skipIf(!realChromium)(
    "a real browser opens a page",
    async () => {
      expect(await chromiumLaunches(realChromium as string)).toEqual({ ok: true });
    },
    40_000,
  );

  test("the install hint uses the t64 names this apt knows, and the old ones otherwise", () => {
    const hint = browserPackagesHint({
      has: (cmd) => cmd === "apt-get",
      aptShow: (names) => {
        expect(names).toContain("libasound2t64");
        return "Package: libasound2t64\nVersion: 1\n\nPackage: libcups2t64\nVersion: 1\n";
      },
    });
    expect(hint).toStartWith("sudo apt-get install ");
    expect(hint).toContain(" libasound2t64 ");
    expect(hint).toContain(" libcups2t64 ");
    expect(hint).toContain(" libnss3 ");
    expect(hint).not.toContain("libnss3t64");
  });

  test("the install hint falls back to dnf, pacman, or the distribution's Chromium", () => {
    const only = (name: string) => ({ has: (cmd: string) => cmd === name, aptShow: () => "" });
    expect(browserPackagesHint(only("dnf"))).toStartWith("sudo dnf install ");
    expect(browserPackagesHint(only("pacman"))).toStartWith("sudo pacman -S --needed ");
    expect(browserPackagesHint(only("none"))).toContain("Chromium package");
  });
});
