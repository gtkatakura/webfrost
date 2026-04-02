import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-schedules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(() => {
  process.env.WEBFROST_DIR = undefined;
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function getApp() {
  const { schedulesRouter } = await import("./schedules");
  const { Elysia } = await import("elysia");
  return new Elysia().use(schedulesRouter);
}

// ---------------------------------------------------------------------------
// POST /schedules
// ---------------------------------------------------------------------------

describe("POST /schedules", () => {
  test("returns 400 for missing fields", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for non-HTTP/HTTPS URL", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "ftp://example.com", cron: "* * * * *" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid url");
  });

  test("returns 400 for invalid cron expression", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", cron: "not-a-cron" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 201 with schedule data for valid request", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", cron: "*/5 * * * *" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      url: string;
      cron: string;
      nextRunAt: string;
    };
    expect(body.id).toBeGreaterThan(0);
    expect(body.url).toBe("https://example.com");
    expect(body.cron).toBe("*/5 * * * *");
    expect(typeof body.nextRunAt).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// GET /schedules
// ---------------------------------------------------------------------------

describe("GET /schedules", () => {
  test("returns empty array initially", async () => {
    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/schedules"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("returns created schedules", async () => {
    const app = await getApp();
    // Create one
    await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", cron: "0 9 * * *" }),
      }),
    );

    const res = await app.handle(new Request("http://localhost/schedules"));
    const body = (await res.json()) as Array<{ url: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.url).toBe("https://example.com");
  });
});

// ---------------------------------------------------------------------------
// DELETE /schedules/:id
// ---------------------------------------------------------------------------

describe("DELETE /schedules/:id", () => {
  test("returns 404 for non-existent schedule", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/schedules/9999", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 204 and removes schedule", async () => {
    const app = await getApp();

    // Create
    const createRes = await app.handle(
      new Request("http://localhost/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", cron: "*/10 * * * *" }),
      }),
    );
    const { id } = (await createRes.json()) as { id: number };

    // Delete
    const deleteRes = await app.handle(
      new Request(`http://localhost/schedules/${id}`, { method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(204);

    // Verify gone
    const listRes = await app.handle(new Request("http://localhost/schedules"));
    const body = await listRes.json();
    expect(body).toEqual([]);
  });
});
