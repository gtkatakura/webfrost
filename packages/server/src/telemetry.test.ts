import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { createApiKey, openDb, setTelemetryBackend, shutdownTelemetry, sql } from "@webfrost/core";
import { createOtelBackend } from "@webfrost/core/src/telemetry-otel";
import { getRunner } from "./context";
import { app } from "./index";
import { logRecordFromArgs } from "./logger";

const serverDir = join(import.meta.dir, "..");

describe("without OTEL_* variables", () => {
  test("the OpenTelemetry SDK is never loaded", async () => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("OTEL_") && value !== undefined) env[key] = value;
    }
    const dir = mkdtempSync(join(tmpdir(), "webfrost-otel-off-"));
    env.WEBFROST_DIR = dir;
    env.AUTH_DISABLED = "true";
    // A fresh process: this one has the SDK loaded by the tests below.
    const script = `
      const core = await import("@webfrost/core");
      const { app } = await import("./src/index.ts");
      const enabled = await core.initTelemetry();
      const res = await app.handle(new Request("http://localhost/health"));
      const loaded = Object.keys(require.cache).filter((k) => k.includes("opentelemetry"));
      console.log(JSON.stringify({ enabled, status: res.status, loaded, fields: core.traceLogFields() }));
    `;
    try {
      const proc = Bun.spawn([process.execPath, "-e", script], {
        cwd: serverDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code, err).toBe(0);
      const line = out.trim().split("\n").at(-1) ?? "{}";
      expect(JSON.parse(line)).toEqual({ enabled: false, status: 200, loaded: [], fields: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("with OpenTelemetry export on", () => {
  const spans = new InMemorySpanExporter();
  let testDir: string;
  let authHeader: Record<string, string> = {};
  let page: ReturnType<typeof Bun.serve>;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ["WEBFROST_DIR", "WEBFROST_ALLOW_PRIVATE_URLS", "WEBFROST_DOMAIN_DELAY_MS"]) {
      saved[key] = process.env[key];
    }
    testDir = mkdtempSync(join(tmpdir(), "webfrost-otel-test-"));
    process.env.WEBFROST_DIR = testDir;
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
    setTelemetryBackend(
      await createOtelBackend({}, { spanExporter: spans, synchronous: true }, {}),
    );
    const db = await openDb(testDir);
    try {
      const { rawKey } = await createApiKey(db, "otel-test");
      authHeader = { authorization: `Bearer ${rawKey}` };
    } finally {
      await db.close();
    }
    page = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<html><head><title>t</title></head><body><p>hello</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
  });

  afterAll(async () => {
    await getRunner().onIdle();
    await shutdownTelemetry();
    page.stop(true);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  const serverSpans = () => spans.getFinishedSpans().filter((s) => s.kind === 1); // SERVER

  /** The snapshots collection, wherever the API mounts it. */
  async function snapshotsPath(): Promise<string> {
    for (const prefix of ["/api/v1", "/api"]) {
      const res = await app.handle(
        new Request(`http://localhost${prefix}/snapshots`, { headers: authHeader }),
      );
      if (res.status !== 404) return `${prefix}/snapshots`;
    }
    throw new Error("no snapshots route");
  }

  test("a request is one server span named after its route, without query or headers", async () => {
    const base = await snapshotsPath();
    spans.reset();
    const res = await app.handle(
      new Request(`http://localhost${base}/987654?token=hunter2`, {
        headers: { ...authHeader, cookie: "session=abc" },
      }),
    );
    expect(res.status).toBe(404);
    const [span] = serverSpans();
    expect(span?.name).toBe(`GET ${base}/:id`);
    expect(span?.attributes).toEqual({
      "http.request.method": "GET",
      "url.scheme": "http",
      "http.route": `${base}/:id`,
      "http.response.status_code": 404,
    });
    const everything = JSON.stringify(spans.getFinishedSpans().map((s) => s.attributes));
    expect(everything).not.toContain("hunter2");
    expect(everything).not.toContain("987654");
    expect(everything).not.toContain("Bearer");
    expect(everything).not.toContain("session=abc");
  });

  test("an incoming traceparent is continued", async () => {
    spans.reset();
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    await app.handle(
      new Request("http://localhost/health", {
        headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
      }),
    );
    const [span] = serverSpans();
    expect(span?.name).toBe("GET /health");
    expect(span?.spanContext().traceId).toBe(traceId);
  });

  test("the pipeline a request queues runs in the request's trace", async () => {
    const base = await snapshotsPath();
    spans.reset();
    const res = await app.handle(
      new Request(`http://localhost${base}`, {
        method: "POST",
        headers: { ...authHeader, "content-type": "application/json" },
        body: JSON.stringify({ url: `http://127.0.0.1:${page.port}/article` }),
      }),
    );
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: number };
    await getRunner().onIdle();

    const finished: ReadableSpan[] = spans.getFinishedSpans();
    const request = finished.find((s) => s.name === `POST ${base}`);
    const run = finished.find((s) => s.name === "snapshot.archive");
    expect(request).toBeDefined();
    expect(run?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(run?.spanContext().traceId).toBe(request?.spanContext().traceId);
    expect(run?.attributes["webfrost.snapshot.id"]).toBe(id);

    const db = await openDb(testDir);
    try {
      const row = await db.get<{ status: string }>(
        sql`SELECT status FROM snapshots WHERE id = ${id}`,
      );
      expect(row?.status).toBe("done");
    } finally {
      await db.close();
    }
  }, 120_000);
});

describe("log records", () => {
  test("keep the message and scalar fields of a pino call", () => {
    expect(
      logRecordFromArgs([{ method: "GET", status: 200, nested: { a: 1 } }, "response"]),
    ).toEqual({ message: "response", attributes: { method: "GET", status: 200 } });
    expect(logRecordFromArgs(["plain"])).toEqual({ message: "plain", attributes: {} });
    expect(logRecordFromArgs([{ err: new TypeError("boom") }, "failed"])).toEqual({
      message: "failed",
      attributes: { "exception.type": "TypeError", "exception.message": "boom" },
    });
  });
});
