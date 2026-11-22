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
