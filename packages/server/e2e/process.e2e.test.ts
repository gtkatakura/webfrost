/**
 * Runs the real server entry point as a child process: the address it binds to and
 * how it shuts down on a signal.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const ENTRY = join(import.meta.dir, "../src/index.ts");

let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
let dir: string | undefined;

afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Start the server and resolve with its "listening" log line. */
async function start(env: Record<string, string>) {
  dir = mkdtempSync(join(tmpdir(), "webfrost-process-e2e-"));
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    WEBFROST_DIR: dir,
    WEBFROST_SCHEDULER: "false",
    PORT: "0",
    ...env,
  };
  child = Bun.spawn([process.execPath, ENTRY], {
    env: childEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  let buffered = "";
  // Read through a reader and release it rather than break out of `for await`, which
  // would cancel the pipe and make the child's later log writes fail.
  const reader = child.stdout.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      for (const line of buffered.split("\n")) {
        if (!line.includes("@webfrost/server listening")) continue;
        return JSON.parse(line) as { hostname: string; port: number };
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`server exited before listening: ${await new Response(child.stderr).text()}`);
}

describe("server process", () => {
  test("AUTH_DISABLED binds to 127.0.0.1 unless HOST is set", async () => {
    const listening = await start({ AUTH_DISABLED: "true" });
    expect(listening.hostname).toBe("127.0.0.1");
    const res = await fetch(`http://127.0.0.1:${listening.port}/health`);
    expect(res.status).toBe(200);
  });

  test("HOST overrides the default address", async () => {
    const listening = await start({ AUTH_DISABLED: "true", HOST: "0.0.0.0" });
    expect(listening.hostname).toBe("0.0.0.0");
  });

  test("SIGTERM stops the server and exits 0", async () => {
    const listening = await start({ AUTH_DISABLED: "true" });
    expect((await fetch(`http://127.0.0.1:${listening.port}/health`)).status).toBe(200);
    child?.kill("SIGTERM");
    const code = await child?.exited;
    expect(code).toBe(0);
  });
});
