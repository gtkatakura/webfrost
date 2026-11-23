import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter } from "./concurrency";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ConcurrencyLimiter slot hand-over", () => {
  it("never exceeds the limit when a new run() lands between a release and the waiter waking", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const task = (name: string, gate: Promise<void>) =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        started.push(name);
        await gate;
        active--;
      });

    const g1 = deferred();
    const g2 = deferred();
    const g3 = deferred();
    const g4 = deferred();
    const first = limiter.run(() => g1.promise);
    const second = limiter.run(() => g2.promise);
    const waiter = task("waiter", g3.promise);
    await Promise.resolve();

    // The first slot is released, then, in the same microtask pass, a newcomer calls run().
    const trigger = deferred();
    let newcomer: Promise<void> = Promise.resolve();
    trigger.promise.then(() => {
      newcomer = task("newcomer", g4.promise);
    });
    g1.resolve();
    trigger.resolve();
    await first;
    await new Promise<void>((r) => setTimeout(r, 5));

    // The slot went to the waiter; the newcomer must queue behind it.
    expect(started).toEqual(["waiter"]);
    expect(peak).toBe(1);

    g3.resolve();
    g4.resolve();
    g2.resolve();
    await Promise.all([second, waiter, newcomer]);
    expect(started).toEqual(["waiter", "newcomer"]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
