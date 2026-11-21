import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedChromium,
  chromiumPointerFile,
  resolveChromium,
  systemChromiumCandidates,
  webfrostBrowsersDir,
  webfrostCacheDir,
} from "./chromium";

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webfrost-chromium-"));
  // An empty PATH and a private cache: nothing from the real machine leaks in.
  env = { WEBFROST_CACHE_DIR: join(dir, "cache"), PATH: join(dir, "empty-bin") };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeBinary(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\n");
  return path;
}

describe("resolveChromium", () => {
  test("WEBFROST_CHROMIUM_PATH wins, even over an installed browser, and is not checked", () => {
    fakeBinary(join(dir, "cache", "browsers", "x"));
    writeFileSync(
      chromiumPointerFile(env),
      JSON.stringify({ executablePath: join(dir, "cache", "browsers", "x") }),
    );
    expect(resolveChromium({ ...env, WEBFROST_CHROMIUM_PATH: "/nope/chrome" })).toEqual({
      path: "/nope/chrome",
      source: "env",
    });
  });

  test("uses the browser named by the cache pointer file", () => {
    const exe = fakeBinary(join(dir, "cache", "browsers", "x", "chrome"));
    mkdirSync(webfrostCacheDir(env), { recursive: true });
    writeFileSync(chromiumPointerFile(env), JSON.stringify({ executablePath: exe }));
    expect(resolveChromium(env)).toEqual({ path: exe, source: "cache" });
  });

  test("finds a completed headless shell install without a pointer file", () => {
    const root = join(webfrostBrowsersDir(env), "chromium_headless_shell-1217");
    const exe = fakeBinary(join(root, "chrome-headless-shell-linux64", "chrome-headless-shell"));
    // An unfinished install (no INSTALLATION_COMPLETE marker) is ignored.
    expect(cachedChromium(env)).toBeUndefined();
    writeFileSync(join(root, "INSTALLATION_COMPLETE"), "");
    expect(cachedChromium(env)).toBe(exe);
  });

  test("falls back to a system browser, then to Playwright's default", () => {
    const bin = join(dir, "empty-bin");
    const chromium = fakeBinary(join(bin, "chromium"));
    if (process.platform === "linux") {
      expect(resolveChromium({ ...env, PATH: bin }, "linux")).toEqual({
        path: chromium,
        source: "system",
      });
    }
    // Windows candidates only exist when their environment variables point somewhere real.
    expect(resolveChromium(env, "win32")).toEqual({ path: undefined, source: "playwright" });
  });
});

describe("systemChromiumCandidates", () => {
  test("lists the usual locations per OS", () => {
    expect(systemChromiumCandidates("darwin", env)).toContain(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(systemChromiumCandidates("linux", env)).toContain("/usr/bin/chromium");
    expect(
      systemChromiumCandidates("win32", { PROGRAMFILES: "C:\\Program Files" }).some((p) =>
        p.endsWith("chrome.exe"),
      ),
    ).toBe(true);
  });
});
