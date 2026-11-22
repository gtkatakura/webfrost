import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { chromiumPointerFile, webfrostBrowsersDir, webfrostCacheDir } from "@webfrost/core";
import { unzipSync } from "fflate";
import { headlessShellVersion } from "./chromium-build" with { type: "macro" };

/** Chrome for Testing's name for each platform, and the headless shell's executable in its zip. */
const PLATFORMS: Record<string, { cft: string; exe: string }> = {
  "linux-x64": { cft: "linux64", exe: "chrome-headless-shell" },
  "linux-arm64": { cft: "linux-arm64", exe: "chrome-headless-shell" },
  "darwin-x64": { cft: "mac-x64", exe: "chrome-headless-shell" },
  "darwin-arm64": { cft: "mac-arm64", exe: "chrome-headless-shell" },
  "win32-x64": { cft: "win64", exe: "chrome-headless-shell.exe" },
};

/** What Chromium needs from a Linux system, as packages, for the hint when it cannot start. */
export const LINUX_BROWSER_PACKAGES = {
  apt: "libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libdbus-1-3 fonts-liberation",
  dnf: "glib2 nss nspr atk at-spi2-atk cups-libs libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm pango cairo alsa-lib dbus-libs liberation-fonts",
  pacman:
    "glib2 nss atk at-spi2-core libcups libxkbcommon libxcomposite libxdamage libxfixes libxrandr mesa pango cairo alsa-lib ttf-liberation",
} as const;

/** The libraries a failed start named ("error while loading shared libraries: libnss3.so: ..."). */
export function missingLibraries(stderr: string): string[] {
  return [
    ...new Set(
      [...stderr.matchAll(/loading shared libraries: ([^\s:]+)/g)].map((m) => m[1] as string),
    ),
  ];
}

/**
 * Debian 13 and Ubuntu 24.04 renamed some libraries with a "t64" suffix (the 64-bit time_t move). Debian still
 * answers to the old names, Ubuntu does not: ask apt which one this system has.
 */
function aptPackages(): string[] {
  const names = LINUX_BROWSER_PACKAGES.apt.split(" ");
  // One apt-cache call for all of them: it prints the packages it knows and skips the rest.
  const probe = Bun.spawnSync(
    ["apt-cache", "show", "--no-all-versions", ...names.map((n) => `${n}t64`)],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const known = new Set(
    [...probe.stdout.toString().matchAll(/^Package: (\S+)$/gm)].map((m) => m[1] as string),
  );
  return names.map((name) => (known.has(`${name}t64`) ? `${name}t64` : name));
}

/** The command that installs what Chromium needs on this kind of Linux, as text for a hint. */
export function browserPackagesHint(): string {
  const has = (cmd: string) => Bun.which(cmd) !== null;
  if (has("apt-get")) return `sudo apt-get install ${aptPackages().join(" ")}`;
  if (has("dnf")) return `sudo dnf install ${LINUX_BROWSER_PACKAGES.dnf}`;
  if (has("pacman")) return `sudo pacman -S --needed ${LINUX_BROWSER_PACKAGES.pacman}`;
  return "Install your distribution's Chromium package, which brings the libraries it needs.";
}

/**
 * Start the browser for real: headless, one blank page. `--version` succeeds even when the system lacks the
 * libraries a page needs, which made setup say "ready" for a browser that could not archive anything.
 */
export async function chromiumLaunches(
  path: string,
  timeoutMs = 20_000,
): Promise<{ ok: true } | { ok: false; reason: string; missing: string[] }> {
  try {
    const proc = Bun.spawn(
      [path, "--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "about:blank"],
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (code === 0 && stdout.includes("<html")) return { ok: true };
    const missing = missingLibraries(stderr);
    const reason = missing.length
      ? `missing system libraries: ${missing.join(", ")}`
      : stderr
          .trim()
          .split("\n")
          .find((l) => l.trim()) || `exited with code ${code}`;
    return { ok: false, reason, missing };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), missing: [] };
  }
}

/** Run `<browser> --version`; the version text when the browser starts, null when it does not. */
export async function chromiumVersion(
  path: string,
  timeoutMs = 15_000,
): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  try {
    const proc = Bun.spawn([path, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (code === 0) return { ok: true, version: stdout.trim() || "unknown version" };
    const reason = stderr.trim().split("\n")[0] || `exited with code ${code}`;
    return { ok: false, reason };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function download(
  urls: string[],
  to: string,
  progress: (done: number, total: number) => void,
): Promise<void> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`${url}: HTTP ${response.status}`);
      }
      const total = Number(response.headers.get("content-length") ?? 0);
      const out = createWriteStream(to);
      let done = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { value: chunk, done: finished } = await reader.read();
        if (finished) break;
        done += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
        progress(done, total);
      }
      await new Promise<void>((resolve, reject) => {
        out.once("error", reject);
        out.end(resolve);
      });
      if (total > 0 && done !== total) {
        throw new Error(`${url}: incomplete download (${done} of ${total} bytes)`);
      }
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Download Playwright's chromium-headless-shell into WebFrost's own cache directory and
 * record where it is. Playwright's installer forks a helper script, which does not exist
 * inside a compiled binary, so the download and unzip are done here with Playwright's
 * registry only supplying the URLs and the layout.
 */
export async function installChromium(options: {
  log: (message: string) => void;
  progress: (done: number, total: number) => void;
}): Promise<string> {
  const platform = PLATFORMS[`${process.platform}-${process.arch}`];
  if (!platform) {
    throw new Error(
      `No headless Chromium build for ${process.platform}/${process.arch}. Install Chrome or Chromium and point WEBFROST_CHROMIUM_PATH at it.`,
    );
  }
  // The version the bundled Playwright drives (read from playwright-core when this file is bundled).
  const version = headlessShellVersion();
  const zipName = `chrome-headless-shell-${platform.cft}.zip`;
  // Playwright's CDN mirrors Chrome for Testing; Google's bucket is the source.
  const urls = [
    `https://cdn.playwright.dev/builds/cft/${version}/${platform.cft}/${zipName}`,
    `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform.cft}/${zipName}`,
  ];
  const directory = join(webfrostBrowsersDir(), `chromium_headless_shell-${version}`);
  const executablePath = join(directory, `chrome-headless-shell-${platform.cft}`, platform.exe);

  const tempDir = mkdtempSync(join(tmpdir(), "webfrost-chromium-"));
  const zipPath = join(tempDir, zipName);
  try {
    options.log(`Downloading Chrome Headless Shell ${version}`);
    await download(urls, zipPath, options.progress);
    options.log(`Unpacking to ${directory}`);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    unpack(new Uint8Array(await Bun.file(zipPath).arrayBuffer()), directory);
    if (!existsSync(executablePath)) {
      throw new Error(`the download did not contain ${platform.exe} where expected`);
    }
    writeFileSync(join(directory, "INSTALLATION_COMPLETE"), "");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  mkdirSync(webfrostCacheDir(), { recursive: true });
  writeFileSync(
    chromiumPointerFile(),
    `${JSON.stringify({ executablePath, version, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return executablePath;
}

/**
 * Extract a zip into `dir`. Entries are kept inside `dir` (no `..` or absolute paths). Zip
 * permissions are not carried over, so every file is made executable: this is a private browser
 * folder whose binaries and helpers must run, and nothing else lives there.
 */
export function unpack(zip: Uint8Array, dir: string): void {
  const files = unzipSync(zip);
  for (const [name, data] of Object.entries(files)) {
    const target = resolve(dir, name);
    if (target !== dir && !target.startsWith(dir + sep)) {
      throw new Error(`refusing to unpack ${name} outside ${dir}`);
    }
    if (name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    chmodSync(target, 0o755);
  }
}
