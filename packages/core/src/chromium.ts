import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Where WebFrost keeps what it downloads (the Chromium that `webfrost setup` installs). */
export function webfrostCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WEBFROST_CACHE_DIR) return env.WEBFROST_CACHE_DIR;
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "webfrost");
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "webfrost");
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "webfrost");
}

/** The directory Playwright browsers are downloaded to by `webfrost setup`. */
export function webfrostBrowsersDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(webfrostCacheDir(env), "browsers");
}

/** Pointer file `webfrost setup` writes once a browser is installed. */
export function chromiumPointerFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(webfrostCacheDir(env), "chromium.json");
}

export type ChromiumSource = "env" | "cache" | "system" | "playwright";

export interface ResolvedChromium {
  /** Absolute path of the executable, or undefined when Playwright's own default applies. */
  path: string | undefined;
  source: ChromiumSource;
}

/** Candidate system browsers, in preference order, for one OS. */
export function systemChromiumCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Chromium.app/Contents/MacOS/Chromium",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    return apps.flatMap((a) => [join("/Applications", a), join(homedir(), "Applications", a)]);
  }
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    const rel = [
      join("Google", "Chrome", "Application", "chrome.exe"),
      join("Chromium", "Application", "chrome.exe"),
      join("Microsoft", "Edge", "Application", "msedge.exe"),
    ];
    return roots.flatMap((root) => rel.map((r) => join(root, r)));
  }
  const fixed = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/opt/google/chrome/chrome",
  ];
  const names = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  const onPath = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((dir) => names.map((n) => join(dir, n)));
  return [...new Set([...onPath, ...fixed])];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const HEADLESS_SHELL_NAMES = new Set([
  "chrome-headless-shell",
  "chrome-headless-shell.exe",
  "headless_shell",
  "headless_shell.exe",
]);

/** Find a headless shell Playwright unpacked under `<cache>/browsers` (two levels deep at most). */
function findInstalledHeadlessShell(browsersDir: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(browsersDir)
      .filter((e) => e.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const root = join(browsersDir, entry);
    if (!existsSync(join(root, "INSTALLATION_COMPLETE"))) continue;
    let subdirs: string[] = [];
    try {
      subdirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const sub of subdirs) {
      const dir = join(root, sub);
      try {
        for (const file of readdirSync(dir)) {
          if (HEADLESS_SHELL_NAMES.has(file) && isFile(join(dir, file))) return join(dir, file);
        }
      } catch {
        // not a directory
      }
    }
  }
  return undefined;
}

/** The browser `webfrost setup` installed into WebFrost's cache directory, if any. */
export function cachedChromium(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const pointer = JSON.parse(readFileSync(chromiumPointerFile(env), "utf8")) as {
      executablePath?: string;
    };
    if (pointer.executablePath && isFile(pointer.executablePath)) return pointer.executablePath;
  } catch {
    // no pointer file yet
  }
  return findInstalledHeadlessShell(webfrostBrowsersDir(env));
}

/**
 * Find the browser to launch. Order:
 * 1. WEBFROST_CHROMIUM_PATH, used as given even when it does not exist (a wrong path
 *    must fail loudly, not silently pick another browser);
 * 2. the headless Chromium `webfrost setup` installed into WebFrost's cache directory;
 * 3. a system Chrome/Chromium in the usual places for the OS;
 * 4. Playwright's own default (its browser cache): `path` is undefined.
 */
export function resolveChromium(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedChromium {
  if (env.WEBFROST_CHROMIUM_PATH) return { path: env.WEBFROST_CHROMIUM_PATH, source: "env" };
  const cached = cachedChromium(env);
  if (cached) return { path: cached, source: "cache" };
  const system = systemChromiumCandidates(platform, env).find(isFile);
  if (system) return { path: system, source: "system" };
  return { path: undefined, source: "playwright" };
}
