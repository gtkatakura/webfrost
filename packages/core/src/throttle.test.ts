import { describe, expect, test } from "bun:test";
import { HostThrottle } from "./throttle";

describe("HostThrottle", () => {
  test("spaces out consecutive runs for the same host", async () => {
    const throttle = new HostThrottle(60);
    const start = Date.now();
    await throttle.wait("example.com");
    await throttle.wait("example.com");
    await throttle.wait("example.com");
    // First run is immediate, the next two wait one gap each.
    expect(Date.now() - start).toBeGreaterThanOrEqual(110);
  });

  test("concurrent callers for one host are queued, not released together", async () => {
    const throttle = new HostThrottle(50);
    const start = Date.now();
    const finished: number[] = [];
    await Promise.all(
      [0, 1, 2].map(() =>
        throttle.wait("example.com").then(() => finished.push(Date.now() - start)),
      ),
    );
    finished.sort((a, b) => a - b);
    expect(finished[0]).toBeLessThan(40);
    expect(finished[2]).toBeGreaterThanOrEqual(90);
  });

  test("different hosts do not wait on each other", async () => {
    const throttle = new HostThrottle(500);
    const start = Date.now();
    await throttle.wait("a.example");
    await throttle.wait("b.example");
    await throttle.wait("c.example");
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("host names are compared case-insensitively", async () => {
    const throttle = new HostThrottle(80);
    const start = Date.now();
    await throttle.wait("Example.com");
    await throttle.wait("example.COM");
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
  });

  test("a delay of 0 disables throttling", async () => {
    const throttle = new HostThrottle(() => 0);
    const start = Date.now();
    for (let i = 0; i < 50; i++) await throttle.wait("example.com");
    expect(Date.now() - start).toBeLessThan(100);
  });
});
