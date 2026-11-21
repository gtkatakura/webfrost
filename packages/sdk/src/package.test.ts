import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as publicApi from "./index";

const pkgDir = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

describe("package.json", () => {
  test("exports point only at built files, types first", () => {
    const entry = pkg.exports["."];
    expect(Object.keys(entry)[0]).toBe("types");
    for (const target of Object.values(entry) as string[]) {
      expect(target).toMatch(/^\.\/dist\//);
    }
    expect(JSON.stringify([pkg.exports, pkg.main, pkg.types])).not.toContain("src/");
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
  });

  test("is an ESM package that ships only dist, README and LICENSE", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.license).toBe("MIT");
  });

  test("has the metadata a registry page needs", () => {
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/gtkatakura/webfrost.git",
      directory: "packages/sdk",
    });
    expect(pkg.homepage).toBe("https://webfrost.dev/docs/reference/sdk");
    expect(pkg.bugs.url).toBeString();
    expect(pkg.description).toBeString();
    expect(pkg.keywords.length).toBeGreaterThan(0);
    expect(pkg.engines.node).toBe(">=18");
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
  });

  test("the packaged LICENSE is the repository's", () => {
    const root = readFileSync(resolve(pkgDir, "../../LICENSE"), "utf8");
    expect(readFileSync(join(pkgDir, "LICENSE"), "utf8")).toBe(root);
  });

  test("ships a README", () => {
    expect(existsSync(join(pkgDir, "README.md"))).toBe(true);
  });
});

describe("public API", () => {
  test("exports the client and the error class", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["WebFrostClient", "WebFrostError"]);
  });
});

describe("declaration build", () => {
  test("tsc emits a complete index.d.ts", () => {
    const out = mkdtempSync(join(tmpdir(), "sdk-dts-"));
    try {
      const run = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json", "--outDir", out], {
        cwd: pkgDir,
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(run.stdout.toString() + run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
      const index = readFileSync(join(out, "index.d.ts"), "utf8");
      for (const name of [
        "WebFrostClient",
        "WebFrostError",
        "SetupResult",
        "SetupStatusResult",
        "ExtractorMeta",
        "SnapshotStatus",
        "ScheduleRunStatus",
        "RequestOptions",
        "IterateSnapshotsOptions",
        "WebFrostErrorCode",
      ]) {
        expect(index).toContain(name);
      }
      const client = readFileSync(join(out, "client.d.ts"), "utf8");
      for (const method of ["iterateSnapshots", "importFile", "archiveUrl", "downloadArchive"]) {
        expect(client).toContain(method);
      }
      // Relative imports in declarations must carry extensions or Node16/NodeNext consumers fail.
      for (const file of ["index.d.ts", "client.d.ts", "mappers.d.ts"]) {
        const text = readFileSync(join(out, file), "utf8");
        for (const m of text.matchAll(/from "(\.[^"]*)"/g)) expect(m[1]).toMatch(/\.js$/);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
