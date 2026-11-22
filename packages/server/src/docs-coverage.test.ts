/**
 * The reference docs list every API route and every environment variable the code reads. A route or a
 * variable added without its line in apps/docs fails here, so the docs cannot fall behind silently.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "./index";

const repo = resolve(import.meta.dir, "../../..");
const docsDir = join(repo, "apps/docs/content/docs");

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && keep(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const allDocs = files(docsDir, (n) => n.endsWith(".mdx"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("docs coverage", () => {
  test("every /api/v1 route is in the REST API reference", () => {
    const restApi = readFileSync(join(docsDir, "reference/rest-api.mdx"), "utf8");
    const missing = app.routes
      .filter((r) => r.path.startsWith("/api/v1/") && r.method !== "OPTIONS")
      // A group's root route is registered as "/snapshots/"; the docs write "/snapshots".
      .map((r) => ({
        method: r.method,
        path: r.path.slice("/api/v1".length).replace(/(.)\/$/, "$1"),
      }))
      .filter(({ method, path }) => !restApi.includes(`| \`${method}\` | \`${path}\` |`))
      .map(({ method, path }) => `${method} ${path}`);
    expect(missing).toEqual([]);
  });

  test("every environment variable the code reads is documented", () => {
    // Read by tests and test helpers only; not settings anyone configures.
    const internal = new Set(["NODE_ENV", "PATH", "WEBFROST_TEST_DATABASE_URL"]);
    const sources = files(join(repo, "packages"), (n) => n.endsWith(".ts"))
      .filter((f) => f.includes("/src/") && !/\.(test|bench)\.ts$|test-utils\.ts$/.test(f))
      .filter((f) => !f.includes("/node_modules/"));
    const read = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /process\.env\.([A-Z][A-Z0-9_]+)|envInt\(\s*"([A-Z][A-Z0-9_]+)"/g,
      )) {
        const name = m[1] ?? m[2];
        if (name && !internal.has(name) && !name.startsWith("MINIO_TEST_")) read.add(name);
      }
    }
    expect(read.size).toBeGreaterThan(20);
    const missing = [...read].filter((name) => !new RegExp(`\\b${name}\\b`).test(allDocs)).sort();
    expect(missing).toEqual([]);
  });
});
