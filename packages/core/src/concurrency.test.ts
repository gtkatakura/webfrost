import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter, createConcurrencyLimiter } from "./concurrency";

describe("ConcurrencyLimiter", () => {
  it("runs tasks up to the limit concurrently", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const running: number[] = [];
    const maxConcurrent: number[] = [];

    const task = (id: number) =>
      limiter.run(async () => {
        running.push(id);
        maxConcurrent.push(running.length);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        running.splice(running.indexOf(id), 1);
      });

    await Promise.all([task(1), task(2), task(3), task(4)]);

    expect(Math.max(...maxConcurrent)).toBe(2);
  });

  it("returns the result of the function", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates errors", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("releases the slot after an error", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter
      .run(async () => {
        throw new Error("first");
      })
      .catch(() => {});
    // should be able to run again
    const result = await limiter.run(async () => "ok");
    expect(result).toBe("ok");
  });

  it("processes the full queue sequentially when limit is 1", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];
    await Promise.all([
      limiter.run(async () => {
        order.push(1);
      }),
      limiter.run(async () => {
        order.push(2);
      }),
      limiter.run(async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("createConcurrencyLimiter", () => {
  it("uses default limit of 3", () => {
    const original = process.env.WEBFROST_CONCURRENCY;
    process.env.WEBFROST_CONCURRENCY = undefined;
    try {
      const limiter = createConcurrencyLimiter();
      expect(limiter.limit).toBe(3);
    } finally {
      if (original !== undefined) process.env.WEBFROST_CONCURRENCY = original;
    }
  });

  it("reads limit from WEBFROST_CONCURRENCY", () => {
    const original = process.env.WEBFROST_CONCURRENCY;
    process.env.WEBFROST_CONCURRENCY = "5";
    try {
      const limiter = createConcurrencyLimiter();
      expect(limiter.limit).toBe(5);
    } finally {
      if (original !== undefined) {
        process.env.WEBFROST_CONCURRENCY = original;
      } else {
        process.env.WEBFROST_CONCURRENCY = undefined;
      }
    }
  });

  it("falls back to default for invalid WEBFROST_CONCURRENCY", () => {
    const original = process.env.WEBFROST_CONCURRENCY;
    process.env.WEBFROST_CONCURRENCY = "not-a-number";
    try {
      const limiter = createConcurrencyLimiter();
      expect(limiter.limit).toBe(3);
    } finally {
      if (original !== undefined) {
        process.env.WEBFROST_CONCURRENCY = original;
      } else {
        process.env.WEBFROST_CONCURRENCY = undefined;
      }
    }
  });

  it("falls back to default for zero or negative WEBFROST_CONCURRENCY", () => {
    const original = process.env.WEBFROST_CONCURRENCY;
    process.env.WEBFROST_CONCURRENCY = "0";
    try {
      const limiter = createConcurrencyLimiter();
      expect(limiter.limit).toBe(3);
    } finally {
      if (original !== undefined) {
        process.env.WEBFROST_CONCURRENCY = original;
      } else {
        process.env.WEBFROST_CONCURRENCY = undefined;
      }
    }
  });
});
