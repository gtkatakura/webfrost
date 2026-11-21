import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { resolveChromium, sql } from "@webfrost/core";
import { chromiumVersion } from "../chromium-install";
import type { Command, Context } from "../cli";
import { VERSION } from "../version";
import { printJson, withDb } from "./shared";

type Level = "ok" | "warn" | "fail";

interface Check {
  name: string;
  level: Level;
  detail: string;
  /** What to do about it. */
  hint?: string | undefined;
  /** Whether a failure of this check makes `doctor` exit with 1. */
  required: boolean;
}

/** True when the binary is a `bun build --compile` executable rather than a source checkout. */
function isCompiled(): boolean {
  return (
    Bun.main.startsWith("/$bunfs/") ||
    Bun.main.startsWith("B:\\~BUN\\") ||
    Bun.main.includes("/~BUN/")
  );
}

const INSTALL_HINTS: Record<string, Partial<Record<NodeJS.Platform, string>> & { other: string }> =
  {
    "yt-dlp": {
      darwin: "brew install yt-dlp",
      linux: "sudo apt install yt-dlp   (Fedora: sudo dnf install yt-dlp; or pipx install yt-dlp)",
      win32: "winget install yt-dlp.yt-dlp",
      other: "https://github.com/yt-dlp/yt-dlp#installation",
    },
    ffmpeg: {
      darwin: "brew install ffmpeg",
      linux: "sudo apt install ffmpeg   (Fedora: sudo dnf install ffmpeg, from RPM Fusion)",
      win32: "winget install Gyan.FFmpeg",
      other: "https://ffmpeg.org/download.html",
    },
  };

function installHint(tool: string): string {
  const hints = INSTALL_HINTS[tool];
  return hints?.[process.platform] ?? hints?.other ?? "";
}

async function toolVersion(tool: string, args: string[]): Promise<string | null> {
  const path = Bun.which(tool);
  if (!path) return null;
  try {
    const proc = Bun.spawn([path, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const line = text.split("\n")[0]?.trim();
    return `${path}${line ? ` (${line})` : ""}`;
  } catch {
    return path;
  }
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function writable(dir: string): { ok: boolean; reason?: string } {
  const probe = join(dir, `.webfrost-doctor-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, "");
    rmSync(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runChecks(ctx: Pick<Context, "dir">): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add({
    name: "WebFrost",
    level: "ok",
    detail: `v${VERSION} (${isCompiled() ? "compiled binary" : "running from source"}, Bun ${Bun.version}, ${process.platform}/${process.arch})`,
    required: true,
  });

  // Data directory and database.
  const dirExisted = existsSync(ctx.dir);
  const w = writable(ctx.dir);
  if (!dirExisted) rmSync(ctx.dir, { recursive: true, force: true });
  add({
    name: "Data directory",
    level: w.ok ? "ok" : "fail",
    detail: w.ok
      ? `${ctx.dir} (writable${dirExisted ? "" : ", will be created on first use"})`
      : `${ctx.dir} is not writable: ${w.reason}`,
    hint: w.ok ? undefined : "Set WEBFROST_DIR to a directory you can write to.",
    required: true,
  });
  if (w.ok && existsSync(join(ctx.dir, "archive.db"))) {
    try {
      const count = await withDb(ctx, async (db) =>
        Number((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`))?.n ?? 0),
      );
      add({
        name: "Database",
        level: "ok",
        detail: `archive.db opens, ${count} snapshot(s)`,
        required: true,
      });
    } catch (err) {
      add({
        name: "Database",
        level: "fail",
        detail: `archive.db cannot be opened: ${err instanceof Error ? err.message : String(err)}`,
        required: true,
      });
    }
  } else if (w.ok) {
    add({
      name: "Database",
      level: "ok",
      detail: "no archive.db yet (created on first use)",
      required: true,
    });
  }

  // Chromium.
  const chromium = resolveChromium();
  if (chromium.path) {
    const check = existsSync(chromium.path)
      ? await chromiumVersion(chromium.path)
      : { ok: false as const, reason: "file does not exist" };
    add({
      name: "Chromium",
      level: check.ok ? "ok" : "fail",
      detail: check.ok
        ? `${chromium.path} (${check.version}; ${chromium.source})`
        : `${chromium.path} does not start: ${check.reason} (${chromium.source})`,
      hint: check.ok ? undefined : "Run `webfrost setup`, or fix WEBFROST_CHROMIUM_PATH.",
      required: true,
    });
  } else {
    add({
      name: "Chromium",
      level: "fail",
      detail:
        "not found (looked in WEBFROST_CHROMIUM_PATH, WebFrost's cache and the usual system locations)",
      hint: "Run `webfrost setup`. Without a browser WebFrost still archives HTML, WARC and Readability, but not screenshots, PDFs or SingleFile.",
      required: true,
    });
  }

  // Optional tools for media extraction.
  for (const [tool, args] of [
    ["yt-dlp", ["--version"]],
    ["ffmpeg", ["-version"]],
  ] as const) {
    const found = await toolVersion(tool, [...args]);
    add({
      name: tool,
      level: found ? "ok" : "warn",
      detail: found ?? "not found (optional: needed to archive video and audio)",
      hint: found ? undefined : installHint(tool),
      required: false,
    });
  }

  // The port `webfrost serve` would use.
  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "127.0.0.1";
  const free = Number.isInteger(port) && (await portFree(port, host));
  add({
    name: `Port ${process.env.PORT ?? "3000"}`,
    level: free ? "ok" : "warn",
    detail: free
      ? `free on ${host}`
      : `in use on ${host}: \`webfrost serve\` would fail unless that is WebFrost itself`,
    hint: free ? undefined : "Choose another port with PORT=<n> or `webfrost serve --port <n>`.",
    required: false,
  });

  return checks;
}

export const doctorCommand: Command = {
  kind: "command",
  name: "doctor",
  summary: "Check that WebFrost has what it needs",
  description:
    "Report the version, the data directory and database, Chromium, yt-dlp and ffmpeg, and whether the server port is free.",
  options: { json: { type: "boolean", description: "Print the checks as JSON" } },
  notes: `
Exit codes:
  0  everything required is in place (optional tools may be missing)
  1  something required is missing: a writable data directory, a working database
     or a Chromium
  yt-dlp and ffmpeg are optional (media extraction) and only produce a warning.`,
  examples: ["webfrost doctor", "webfrost doctor --json"],
  async run(ctx) {
    const checks = await runChecks(ctx);
    const failed = checks.some((c) => c.level === "fail" && c.required);
    if (ctx.bool("json")) {
      printJson({ ok: !failed, checks });
      return failed ? 1 : 0;
    }
    const mark: Record<Level, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };
    for (const c of checks) {
      console.log(`[${mark[c.level]}] ${c.name}: ${c.detail}`);
      if (c.hint) console.log(`       -> ${c.hint}`);
    }
    console.log(failed ? "\nSomething required is missing." : "\nAll required checks passed.");
    return failed ? 1 : 0;
  },
};
