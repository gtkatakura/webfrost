import { afterEach, describe, expect, test } from "bun:test";
import { gracefulShutdown, installShutdownHandlers, shutdownTimeoutMs } from "./shutdown";

const quietLogger = { info: () => {}, warn: () => {} };

/** A runner whose single job finishes when `finish()` is called. */
function fakeRunner() {
  let finish = () => {};
  let size = 1;
  const idle = new Promise<void>((resolve) => {
    finish = () => {
      size = 0;
      resolve();
    };
  });
  return {
    runner: {
      get size() {
        return size;
      },
      onIdle: () => idle,
    },
    finish: () => finish(),
  };
}

describe("gracefulShutdown", () => {
  test("stops the scheduler, then the server, then waits for in-flight jobs", async () => {
    const order: string[] = [];
    const { runner, finish } = fakeRunner();
    const done = gracefulShutdown({
      stopBackgroundWork: () => order.push("scheduler"),
      stopServer: async () => {
        order.push("server");
      },
      runner,
      timeoutMs: 5_000,
      logger: quietLogger,
    });
    await Bun.sleep(10);
    order.push("job finished");
    finish();
    expect(await done).toBe(true);
    expect(order).toEqual(["scheduler", "server", "job finished"]);
  });

  test("closes the database pools last, after the jobs are idle", async () => {
    const order: string[] = [];
    const { runner, finish } = fakeRunner();
    const done = gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: async () => {},
      runner,
      closeDatabases: async () => {
        order.push("pools closed");
      },
      timeoutMs: 5_000,
      logger: quietLogger,
    });
    await Bun.sleep(10);
    order.push("job finished");
    finish();
    expect(await done).toBe(true);
    expect(order).toEqual(["job finished", "pools closed"]);
  });

  test("flushes OpenTelemetry data after the jobs, even when the deadline cut them off", async () => {
    const order: string[] = [];
    const { runner, finish } = fakeRunner();
    const done = gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: async () => {},
      runner,
      closeDatabases: async () => {
        order.push("pools closed");
      },
      flushTelemetry: async () => {
        order.push("telemetry flushed");
      },
      timeoutMs: 5_000,
      logger: quietLogger,
    });
    await Bun.sleep(10);
    order.push("job finished");
    finish();
    expect(await done).toBe(true);
    expect(order).toEqual(["job finished", "pools closed", "telemetry flushed"]);

    const flushed: string[] = [];
    const stuck = fakeRunner();
    expect(
      await gracefulShutdown({
        stopBackgroundWork: () => {},
        stopServer: async () => {},
        runner: stuck.runner,
        flushTelemetry: async () => {
          flushed.push("flushed");
          throw new Error("collector unreachable");
        },
        timeoutMs: 20,
        logger: quietLogger,
      }),
    ).toBe(false);
    expect(flushed).toEqual(["flushed"]);
  });

  test("a failing or hanging closeDatabases does not block the exit", async () => {
    const failing = fakeRunner();
    failing.finish();
    expect(
      await gracefulShutdown({
        stopBackgroundWork: () => {},
        stopServer: async () => {},
        runner: failing.runner,
        closeDatabases: async () => {
          throw new Error("boom");
        },
        timeoutMs: 5_000,
        logger: quietLogger,
      }),
    ).toBe(true);

    const hanging = fakeRunner();
    hanging.finish();
    const started = Date.now();
    await gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: async () => {},
      runner: hanging.runner,
      closeDatabases: () => new Promise<void>(() => {}),
      timeoutMs: 5_000,
      logger: quietLogger,
    });
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  test("gives up on jobs after the timeout", async () => {
    const { runner } = fakeRunner();
    const started = Date.now();
    const finished = await gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: () => {},
      runner,
      timeoutMs: 30,
      logger: quietLogger,
    });
    expect(finished).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("returns at once when nothing is running", async () => {
    const finished = await gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: () => {},
      runner: { size: 0, onIdle: async () => {} },
      timeoutMs: 60_000,
      logger: quietLogger,
    });
    expect(finished).toBe(true);
  });

  test("stops a real Bun server: no new connections afterwards", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    const url = `http://127.0.0.1:${server.port}/`;
    // No keep-alive: a pooled connection would outlive the listener.
    expect(await (await fetch(url, { headers: { connection: "close" } })).text()).toBe("ok");
    await gracefulShutdown({
      stopBackgroundWork: () => {},
      stopServer: () => server.stop(),
      runner: { size: 0, onIdle: async () => {} },
      timeoutMs: 5_000,
      logger: quietLogger,
    });
    await expect(fetch(url)).rejects.toThrow();
  });
});

describe("installShutdownHandlers", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  test("SIGTERM drains and exits 0", async () => {
    const exits: number[] = [];
    let stopped = false;
    uninstall = installShutdownHandlers(
      {
        stopBackgroundWork: () => {},
        stopServer: () => {
          stopped = true;
        },
        runner: { size: 0, onIdle: async () => {} },
        timeoutMs: 1_000,
        logger: quietLogger,
      },
      (code) => exits.push(code),
    );
    process.emit("SIGTERM", "SIGTERM");
    await Bun.sleep(10);
    expect(stopped).toBe(true);
    expect(exits).toEqual([0]);
  });
});

describe("shutdownTimeoutMs", () => {
  afterEach(() => Reflect.deleteProperty(process.env, "WEBFROST_SHUTDOWN_TIMEOUT_MS"));

  test("defaults to 20 seconds and reads WEBFROST_SHUTDOWN_TIMEOUT_MS", () => {
    expect(shutdownTimeoutMs()).toBe(20_000);
    process.env.WEBFROST_SHUTDOWN_TIMEOUT_MS = "5000";
    expect(shutdownTimeoutMs()).toBe(5_000);
    process.env.WEBFROST_SHUTDOWN_TIMEOUT_MS = "soon";
    expect(shutdownTimeoutMs()).toBe(20_000);
  });
});
