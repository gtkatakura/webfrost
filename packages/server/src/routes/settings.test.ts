import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "webfrost-settings-test-"));
  process.env.WEBFROST_DIR = testDir;
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  rmSync(testDir, { recursive: true, force: true });
});

async function createKey(name: string) {
  const { settingsRouter } = await import("./settings");
  const { Elysia } = await import("elysia");
  return new Elysia().use(settingsRouter).handle(
    new Request("http://localhost/settings/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

describe("POST /settings/keys", () => {
  test("creates a key", async () => {
    const res = await createKey("ci");
    expect(res.status).toBe(201);
  });

  test("rejects key names longer than 100 characters with a JSON 400", async () => {
    const res = await createKey("k".repeat(101));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request", code: "VALIDATION" });
  });
});
