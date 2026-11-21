import {
  chmodSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumPointerFile, webfrostBrowsersDir, webfrostCacheDir } from "@webfrost/core";

/** The slice of Playwright's browser registry that installing needs. */
interface RegistryExecutable {
  directory?: string;
  downloadURLs?: string[];
  title?: string;
  browserVersion?: string;
  executablePath(): string | undefined;
}

interface Registry {
  findExecutable(name: string): RegistryExecutable | undefined;
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
  // Playwright reads its browsers directory once, when the registry module loads.
  process.env.PLAYWRIGHT_BROWSERS_PATH = webfrostBrowsersDir();
  const { registry } = (await import("playwright-core/lib/server/registry/index")) as unknown as {
    registry: Registry;
  };
  const { extract } = (await import("playwright-core/lib/zipBundle")) as unknown as {
    extract: (zip: string, opts: { dir: string }) => Promise<void>;
  };

  const executable = registry.findExecutable("chromium-headless-shell");
  const directory = executable?.directory;
  const executablePath = executable?.executablePath();
  if (!executable || !directory || !executablePath || !executable.downloadURLs?.length) {
    throw new Error(
      `Playwright has no headless Chromium build for ${process.platform}/${process.arch}. Install Chrome or Chromium and point WEBFROST_CHROMIUM_PATH at it.`,
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "webfrost-chromium-"));
  const zipPath = join(tempDir, "chromium-headless-shell.zip");
  try {
    options.log(
      `Downloading ${executable.title ?? "Chromium headless shell"} ${executable.browserVersion ?? ""}`.trim(),
    );
    await download(executable.downloadURLs, zipPath, options.progress);
    options.log(`Unpacking to ${directory}`);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    await extract(zipPath, { dir: directory });
    chmodSync(executablePath, 0o755);
    writeFileSync(join(directory, "INSTALLATION_COMPLETE"), "");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  mkdirSync(webfrostCacheDir(), { recursive: true });
  writeFileSync(
    chromiumPointerFile(),
    `${JSON.stringify({ executablePath, version: executable.browserVersion, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return executablePath;
}
