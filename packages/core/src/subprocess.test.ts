import { describe, expect, test } from "bun:test";
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
});
