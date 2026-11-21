import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./subprocess";

describe("runProcess", () => {
  test("returns exit code and output of a normal command", async () => {
    const result = await runProcess(["sh", "-c", "echo out; echo err >&2; exit 3"]);
    expect(result).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n" });
  });

  test("does not wait for a background process that keeps the pipes open", async () => {
    // The shell exits at once, but the sleep it left behind inherited stdout and
    // stderr, so neither pipe reaches EOF for 20 seconds. This is the situation
    // that used to leave a pipeline waiting on a yt-dlp that had long finished.
    const start = Date.now();
    const result = await runProcess(
      ["sh", "-c", "sleep 20 & echo started; echo 'ERROR: nope' >&2; exit 1"],
      { graceMs: 300 },
    );
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("started\n");
    expect(result.stderr).toContain("ERROR: nope");
  });

  test("kills a command that exceeds its timeout", async () => {
    const start = Date.now();
    const result = await runProcess(["sleep", "20"], { timeoutMs: 300, graceMs: 300 });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.exitCode).not.toBe(0);
  });

  test("collects large output without truncation", async () => {
    const result = await runProcess(["sh", "-c", "head -c 3000000 /dev/zero | tr '\\0' 'x'"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(3_000_000);
  });

  test("throws ENOENT for a missing executable", async () => {
    let code: string | undefined;
    try {
      await runProcess(["webfrost-no-such-binary-xyz"]);
    } catch (err) {
      code = (err as NodeJS.ErrnoException).code;
    }
    expect(code).toBe("ENOENT");
  });

  test("kills the whole process group on timeout when processGroup is set", async () => {
    // The shell starts a background sleep (like yt-dlp starting ffmpeg) and prints its pid.
    const result = await runProcess(["sh", "-c", "sleep 30 & echo $!; wait"], {
      timeoutMs: 300,
      graceMs: 300,
      processGroup: true,
    });
    const child = Number(result.stdout.trim());
    expect(child).toBeGreaterThan(0);
    expect(await isGone(child)).toBe(true);
  });

  test("aborting the signal kills the process group and rejects", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const run = runProcess(["sh", "-c", 'sleep 30 & echo $! > "$0"; wait', pidFile()], {
      signal: controller.signal,
      graceMs: 300,
      processGroup: true,
    });
    const child = await waitForPid(lastPidFile);
    controller.abort(new Error("given up"));
    await expect(run).rejects.toThrow("given up");
    expect(Date.now() - start).toBeLessThan(5000);
    expect(await isGone(child)).toBe(true);
  });

  test("a signal aborted before the start spawns nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runProcess(["sleep", "5"], { signal: controller.signal })).rejects.toThrow();
  });

  test("without processGroup, abort still kills the direct child", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const run = runProcess(["sleep", "30"], { signal: controller.signal, graceMs: 300 });
    setTimeout(() => controller.abort(), 100);
    await expect(run).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

let lastPidFile = "";
function pidFile(): string {
  lastPidFile = join(
    tmpdir(),
    `webfrost-pid-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  return lastPidFile;
}

async function waitForPid(file: string): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const f = Bun.file(file);
    if (await f.exists()) {
      const pid = Number((await f.text()).trim());
      if (pid > 0) return pid;
    }
    await Bun.sleep(20);
  }
  throw new Error("child pid never written");
}

/** True once `pid` no longer runs (gone, or a zombie waiting to be reaped by init). */
async function isGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      const stat = await Bun.file(`/proc/${pid}/stat`).text();
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return true;
    } catch {
      return true;
    }
    await Bun.sleep(20);
  }
  return false;
}
