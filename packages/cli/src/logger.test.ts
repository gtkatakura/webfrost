import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createLogger, resolveLogLevel } from "./logger";

// ---------------------------------------------------------------------------
// createLogger — log level filtering
// ---------------------------------------------------------------------------

describe("createLogger", () => {
  // Capture writes instead of actually writing to process.stdout/stderr
  let stdoutLines: string[];
  let stderrLines: string[];
  let origStdout: typeof process.stdout.write;
  let origStderr: typeof process.stderr.write;

  beforeEach(() => {
    stdoutLines = [];
    stderrLines = [];
    origStdout = process.stdout.write.bind(process.stdout);
    origStderr = process.stderr.write.bind(process.stderr);

    process.stdout.write = (chunk: string) => {
      stdoutLines.push(chunk);
      return true;
    };
    process.stderr.write = (chunk: string) => {
      stderrLines.push(chunk);
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  });

  test("default level=info: info and above pass, debug is suppressed", () => {
    const log = createLogger("info");
    log.debug("hidden");
    log.info("shown");
    log.warn("shown warn");
    log.error("shown error");

    const allOut = stdoutLines.join("");
    const allErr = stderrLines.join("");

    expect(allOut).not.toContain("hidden");
    expect(allOut).toContain("shown");
    expect(allErr).toContain("shown warn");
    expect(allErr).toContain("shown error");
  });

  test("level=debug: all messages pass", () => {
    const log = createLogger("debug");
    log.debug("dbg msg");
    log.info("inf msg");
    log.warn("wrn msg");
    log.error("err msg");

    const allOut = stdoutLines.join("");
    const allErr = stderrLines.join("");

    expect(allOut).toContain("dbg msg");
    expect(allOut).toContain("inf msg");
    expect(allErr).toContain("wrn msg");
    expect(allErr).toContain("err msg");
  });

  test("level=warn: only warn and error pass", () => {
    const log = createLogger("warn");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    const allOut = stdoutLines.join("");
    const allErr = stderrLines.join("");

    expect(allOut).not.toContain("d");
    expect(allOut).not.toContain("i");
    expect(allErr).toContain("w");
    expect(allErr).toContain("e");
  });

  test("level=error: only error passes", () => {
    const log = createLogger("error");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("only this");

    const allOut = stdoutLines.join("");
    const allErr = stderrLines.join("");

    expect(allOut).not.toContain("d");
    expect(allOut).not.toContain("i");
    expect(allErr).not.toContain("w");
    expect(allErr).toContain("only this");
  });

  test("info and debug go to stdout; warn and error go to stderr", () => {
    const log = createLogger("debug");
    log.info("stdout-msg");
    log.debug("stdout-dbg");
    log.warn("stderr-warn");
    log.error("stderr-err");

    expect(stdoutLines.join("")).toContain("stdout-msg");
    expect(stdoutLines.join("")).toContain("stdout-dbg");
    expect(stderrLines.join("")).toContain("stderr-warn");
    expect(stderrLines.join("")).toContain("stderr-err");

    // Cross-check: warn/error must NOT appear on stdout
    expect(stdoutLines.join("")).not.toContain("stderr-warn");
    expect(stdoutLines.join("")).not.toContain("stderr-err");
  });

  test("output lines include HH:MM:SS timestamp and level label", () => {
    const log = createLogger("debug");
    log.info("check-format");

    const line = stdoutLines.find((l) => l.includes("check-format")) ?? "";
    // Timestamp pattern [HH:MM:SS]
    expect(line).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    // Level label
    expect(line).toContain("INFO");
  });
});

// ---------------------------------------------------------------------------
// resolveLogLevel
// ---------------------------------------------------------------------------

describe("resolveLogLevel", () => {
  const origEnv = process.env.WEBFROST_LOG_LEVEL;

  afterEach(() => {
    if (origEnv === undefined) {
      Reflect.deleteProperty(process.env, "WEBFROST_LOG_LEVEL");
    } else {
      process.env.WEBFROST_LOG_LEVEL = origEnv;
    }
  });

  test("--verbose flag returns debug", () => {
    expect(resolveLogLevel({ verbose: true, quiet: false })).toBe("debug");
  });

  test("--quiet flag returns warn", () => {
    expect(resolveLogLevel({ verbose: false, quiet: true })).toBe("warn");
  });

  test("--verbose takes precedence over --quiet", () => {
    expect(resolveLogLevel({ verbose: true, quiet: true })).toBe("debug");
  });

  test("WEBFROST_LOG_LEVEL env var is respected when no flags", () => {
    process.env.WEBFROST_LOG_LEVEL = "error";
    expect(resolveLogLevel({ verbose: false, quiet: false })).toBe("error");
  });

  test("flags take precedence over WEBFROST_LOG_LEVEL", () => {
    process.env.WEBFROST_LOG_LEVEL = "error";
    expect(resolveLogLevel({ verbose: true, quiet: false })).toBe("debug");
  });

  test("invalid WEBFROST_LOG_LEVEL falls back to info", () => {
    process.env.WEBFROST_LOG_LEVEL = "verbose"; // not a valid level
    expect(resolveLogLevel({ verbose: false, quiet: false })).toBe("info");
  });

  test("default is info when no flags and no env", () => {
    Reflect.deleteProperty(process.env, "WEBFROST_LOG_LEVEL");
    expect(resolveLogLevel({ verbose: false, quiet: false })).toBe("info");
  });
});
