import { afterEach, describe, expect, test } from "bun:test";

describe("logger", () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, "LOG_LEVEL");
  });

  test("exports a pino logger instance", async () => {
    const { logger } = await import("./logger");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  test("defaults to info level when LOG_LEVEL is not set", async () => {
    Reflect.deleteProperty(process.env, "LOG_LEVEL");
    // Re-import to test module-level env resolution
    const { logger } = await import("./logger");
    // Default pino level is "info" (30) unless LOG_LEVEL overrides
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? "info");
  });

  test("child() returns a child logger with bound context", async () => {
    const { logger } = await import("./logger");
    const child = logger.child({ snapshotId: 42 });
    expect(typeof child.info).toBe("function");
    expect(typeof child.error).toBe("function");
  });
});
