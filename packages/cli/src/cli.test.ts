/**
 * Command-line behaviour: parsing, help, exit codes and the machine-readable output.
 * Runs the real entry point as a child process against a throwaway data directory.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseExpires } from "./commands/admin";
import { ensureSessionSecret } from "./commands/serve";
import { UsageError } from "./errors";

const CLI = join(import.meta.dir, "index.ts");

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webfrost-cli-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
): Promise<Result> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    WEBFROST_DIR: dir,
    ...opts.env,
  };
  // The password variable must not leak in from the machine running the tests.
  if (!opts.env?.WEBFROST_PASSWORD) Reflect.deleteProperty(env, "WEBFROST_PASSWORD");
  const proc = Bun.spawn([process.execPath, "run", CLI, ...args], {
    env,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("help and version", () => {
  test("--version prints the version", async () => {
    const r = await cli(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^webfrost v\d+\.\d+\.\d+/);
  });

  test("no arguments prints help and exits 2", async () => {
    const r = await cli([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Usage: webfrost <command>");
    expect(r.stdout).toBe("");
  });

  test("--help and help list the commands and exit 0", async () => {
    for (const args of [["--help"], ["help"], ["-h"]]) {
      const r = await cli(args);
      expect(r.exitCode).toBe(0);
      for (const name of ["serve", "setup", "doctor", "add", "import", "schedule"]) {
        expect(r.stdout).toContain(name);
      }
    }
  });

  test("<command> --help and help <command> describe the command's flags", async () => {
    for (const args of [
      ["list", "--help"],
      ["help", "list"],
    ]) {
      const r = await cli(args);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Usage: webfrost list [options]");
      expect(r.stdout).toContain("--status <status>");
      expect(r.stdout).toContain("--json");
    }
  });

  test("help works for nested commands and groups", async () => {
    const nested = await cli(["help", "admin", "key", "create"]);
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("--expires <date>");
    const group = await cli(["schedule", "--help"]);
    expect(group.exitCode).toBe(0);
    expect(group.stdout).toContain("worker");
  });

  test("a group without a subcommand shows its help and exits 2", async () => {
    const r = await cli(["tag"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Usage: webfrost tag <command>");
  });
});

describe("usage errors exit 2", () => {
  test("unknown command", async () => {
    const r = await cli(["frobnicate"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Error: Unknown command: frobnicate");
  });

  test("unknown subcommand", async () => {
    const r = await cli(["tag", "frobnicate"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Unknown command: tag frobnicate");
  });

  test("unknown flag", async () => {
    const r = await cli(["list", "--bogus"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Unknown option '--bogus'");
    expect(r.stderr).toContain("Usage: webfrost list");
  });

  test("missing and extra positional arguments", async () => {
    const missing = await cli(["delete"]);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Missing argument <id>");
    const extra = await cli(["delete", "1", "2"]);
    expect(extra.exitCode).toBe(2);
    expect(extra.stderr).toContain('Unexpected argument "2"');
  });

  test("invalid values", async () => {
    expect((await cli(["list", "--limit", "abc"])).exitCode).toBe(2);
    expect((await cli(["list", "--limit=0"])).exitCode).toBe(2);
    expect((await cli(["delete", "-3"])).exitCode).toBe(2);
    expect((await cli(["add", "ftp://example.com"])).exitCode).toBe(2);
    expect((await cli(["add", "not a url"])).exitCode).toBe(2);
    expect((await cli(["import", "--format=bogus", "x"])).exitCode).toBe(2);
  });

  test("errors are one line, with no stack trace, unless --verbose", async () => {
    const plain = await cli(["delete", "999"]);
    expect(plain.exitCode).toBe(1);
    expect(plain.stderr).toBe("Error: Snapshot 999 not found.\n");
  });
});

describe("--flag value and --flag=value are the same", () => {
  test("tag create --color", async () => {
    const spaced = await cli(["tag", "create", "A", "--color", "#111111"]);
    const joined = await cli(["tag", "create", "B", "--color=#222222"]);
    expect(spaced.exitCode).toBe(0);
    expect(joined.exitCode).toBe(0);
    const list = await cli(["tag", "list"]);
    expect(list.stdout).toContain("#111111");
    expect(list.stdout).toContain("#222222");
  });

  test("global flags go after the command, not before it", async () => {
    const r = await cli(["--quiet", "tag", "create", "C"]);
    // The global flags are command options, so they go after the command path.
    expect(r.exitCode).toBe(2);
    const ok = await cli(["tag", "create", "--quiet", "C"]);
    expect(ok.exitCode).toBe(0);
  });
});

describe("list, search and delete", () => {
  async function seed(): Promise<void> {
    const { openDb } = await import("@webfrost/core");
    const db = openDb(dir);
    for (const [url, status] of [
      ["https://a.example/", "done"],
      ["https://b.example/", "failed"],
      ["https://c.example/", "done"],
    ] as const) {
      db.query("INSERT INTO snapshots (url, status) VALUES (?, ?)").run(url, status);
    }
    db.close();
  }

  test("list --json, --status and --limit", async () => {
    await seed();
    const all = JSON.parse((await cli(["list", "--json"])).stdout);
    expect(all.total).toBe(3);
    expect(all.items[0].url).toBe("https://c.example/");

    const failed = JSON.parse((await cli(["list", "--status", "failed", "--json"])).stdout);
    expect(failed.items.map((s: { url: string }) => s.url)).toEqual(["https://b.example/"]);

    const limited = await cli(["list", "--limit=1"]);
    expect(limited.stdout.trim().split("\n")).toHaveLength(1);
    expect(limited.stderr).toContain("Showing 1 of 3");
  });

  test("list on an empty archive exits 0", async () => {
    const r = await cli(["list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("search --json paginates", async () => {
    const r = await cli(["search", "nothing", "--limit", "5", "--page=2", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ items: [], total: 0, page: 2, limit: 5 });
  });
});

describe("add", () => {
  test("--json prints the result on stdout and the logs on stderr; exit 0 when done", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<html><head><title>T</title></head><body><p>hello</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    try {
      const r = await cli(["add", `http://localhost:${server.port}/`, "--json"], {
        env: { WEBFROST_ALLOW_PRIVATE_URLS: "true" },
      });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.status).toBe("done");
      expect(
        out.extractors.some((e: { name: string; ok: boolean }) => e.name === "html" && e.ok),
      ).toBe(true);
      expect(r.stderr).toContain("Archiving");
    } finally {
      server.stop(true);
    }
  });

  test("a failed snapshot exits 1 and --json still reports it", async () => {
    const r = await cli(["add", "http://localhost:19999/unreachable", "--json"], {
      env: { WEBFROST_ALLOW_PRIVATE_URLS: "true" },
    });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).status).toBe("failed");
  });
});

describe("import", () => {
  test("exits 1 when a snapshot fails, 0 when a file has no URLs", async () => {
    const file = join(dir, "urls.txt");
    await Bun.write(file, "http://localhost:19999/a\n");
    const failed = await cli(["import", file], { env: { WEBFROST_ALLOW_PRIVATE_URLS: "true" } });
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("failed=1");

    const emptyFile = join(dir, "empty.txt");
    await Bun.write(emptyFile, "nothing to see\n");
    const empty = await cli(["import", emptyFile]);
    expect(empty.exitCode).toBe(0);
  });

  test("a missing file is an error", async () => {
    const r = await cli(["import", join(dir, "nope.html")]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Cannot read file");
  });
});

describe("admin create", () => {
  test("reads the password from stdin", async () => {
    const r = await cli(["admin", "create", "--username", "root", "--password-stdin"], {
      stdin: "correct horse battery\n",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Default API key");
    expect(r.stderr).not.toContain("shell history");
  });

  test("reads the password from WEBFROST_PASSWORD", async () => {
    const r = await cli(["admin", "create", "--username", "root"], {
      env: { WEBFROST_PASSWORD: "correct horse battery" },
    });
    expect(r.exitCode).toBe(0);
  });

  test("--password still works but warns about shell history", async () => {
    const r = await cli(["admin", "create", "--username", "root", "--password", "hunter2hunter2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("shell history");
  });

  test("with no password and no terminal it is a usage error", async () => {
    const r = await cli(["admin", "create", "--username", "root"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--password-stdin");
  });

  test("short passwords are refused", async () => {
    const r = await cli(["admin", "create", "--username", "root", "--password-stdin"], {
      stdin: "short\n",
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("at least 8");
  });
});

describe("admin key create --expires", () => {
  test("accepts an ISO date and refuses anything else", async () => {
    const future = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10);
    const ok = await cli(["admin", "key", "create", "--name", "ci", "--expires", future]);
    expect(ok.exitCode).toBe(0);
    const list = await cli(["admin", "key", "list"]);
    expect(list.stdout).toContain(`expires:${future}T00:00:00.000Z`);

    for (const bad of ["tomorrow", "2027-13-45", "12/31/2027", "2001-01-01"]) {
      const r = await cli(["admin", "key", "create", "--name", "x", "--expires", bad]);
      expect(r.exitCode).toBe(2);
    }
  });

  test("parseExpires normalizes to UTC", () => {
    expect(parseExpires("2999-01-02", [])).toBe("2999-01-02T00:00:00.000Z");
    expect(parseExpires("2999-01-02T03:04:05+02:00", [])).toBe("2999-01-02T01:04:05.000Z");
    expect(() => parseExpires("soon", [])).toThrow(UsageError);
  });
});

describe("doctor", () => {
  test("--json reports the checks; exit 0 when Chromium is found", async () => {
    const chromium = Bun.which("chromium") ?? "/usr/bin/chromium";
    const r = await cli(["doctor", "--json"], { env: { WEBFROST_CHROMIUM_PATH: chromium } });
    const out = JSON.parse(r.stdout);
    expect(out.checks.map((c: { name: string }) => c.name)).toContain("Chromium");
    const names = out.checks.map((c: { name: string }) => c.name);
    expect(names).toContain("yt-dlp");
    expect(names).toContain("ffmpeg");
    expect(names).toContain("Data directory");
    if (Bun.which("chromium")) expect(r.exitCode).toBe(0);
  });

  test("exits 1 when the Chromium path is wrong", async () => {
    const r = await cli(["doctor"], { env: { WEBFROST_CHROMIUM_PATH: join(dir, "missing") } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("[FAIL] Chromium");
  });
});

describe("serve session secret", () => {
  test("is generated once, stored with mode 0600, and reused", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(ensureSessionSecret(dir, env)).toBe("generated");
    const first = env.SESSION_SECRET;
    expect(first).toHaveLength(64);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "session-secret")).mode & 0o777).toBe(0o600);
    }
    const again: NodeJS.ProcessEnv = {};
    expect(ensureSessionSecret(dir, again)).toBe("file");
    expect(again.SESSION_SECRET).toBe(first);
  });

  test("SESSION_SECRET and AUTH_DISABLED win over the file", () => {
    expect(ensureSessionSecret(dir, { SESSION_SECRET: "x".repeat(40) })).toBe("env");
    expect(ensureSessionSecret(dir, { AUTH_DISABLED: "true" })).toBe("disabled");
  });
});
