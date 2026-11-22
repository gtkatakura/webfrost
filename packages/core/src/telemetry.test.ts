import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { sql } from "kysely";
import { openDb } from "./db";
import { JobRunner } from "./jobs";
import { addUrl } from "./pipeline";
import {
  failureCategory,
  initTelemetry,
  setTelemetryBackend,
  shutdownTelemetry,
  telemetryConfigured,
  telemetryEnabled,
  withSpan,
} from "./telemetry";
import { createOtelBackend, describeStatement, resourceFromEnv } from "./telemetry-otel";
import { isSqliteRun } from "./test-utils";

describe("telemetryConfigured", () => {
  test("off without an OTLP endpoint", () => {
    expect(telemetryConfigured({})).toBe(false);
    expect(telemetryConfigured({ OTEL_SERVICE_NAME: "webfrost" })).toBe(false);
    expect(telemetryConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBe(false);
  });

  test("on with the shared or a per-signal endpoint", () => {
    expect(telemetryConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(
      true,
    );
    expect(
      telemetryConfigured({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://c:4318/v1/traces" }),
    ).toBe(true);
    expect(telemetryConfigured({ OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://c:4318/v1/logs" })).toBe(
      true,
    );
  });

  test("OTEL_SDK_DISABLED=true wins", () => {
    expect(
      telemetryConfigured({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        OTEL_SDK_DISABLED: "true",
      }),
    ).toBe(false);
  });

  test("initTelemetry does nothing when not configured", async () => {
    const saved = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    Reflect.deleteProperty(process.env, "OTEL_EXPORTER_OTLP_ENDPOINT");
    try {
      expect(await initTelemetry()).toBe(false);
      expect(telemetryEnabled()).toBe(false);
      // The no-op span still runs the work.
      const result = withSpan("x", {}, (span) => {
        span.setAttributes({ a: 1 });
        return 42;
      });
      expect(result).toBe(42);
    } finally {
      if (saved !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved;
    }
  });
});

describe("helpers", () => {
  test("describeStatement keeps the operation and table, nothing else", () => {
    expect(describeStatement("SELECT id FROM snapshots WHERE id = ?")).toEqual({
      operation: "SELECT",
      table: "snapshots",
    });
    expect(
      describeStatement(`INSERT INTO "archive_results" (snapshot_id) VALUES ($1) RETURNING id`),
    ).toEqual({ operation: "INSERT", table: "archive_results" });
    expect(describeStatement("\n   UPDATE job_queue\n SET status = ? WHERE id = ?")).toEqual({
      operation: "UPDATE",
      table: "job_queue",
    });
    expect(describeStatement("delete from `tags` where id = ?")).toEqual({
      operation: "DELETE",
      table: "tags",
    });
    expect(describeStatement("begin immediate")).toEqual({ operation: "BEGIN" });
    expect(describeStatement("VACUUM")).toEqual({});
  });

  test("failureCategory turns messages into short reasons", () => {
    expect(failureCategory("extractor pdf timed out after 60000ms")).toBe("timeout");
    expect(failureCategory("blocked: page redirected to a non-public address (x)")).toBe("blocked");
    expect(failureCategory("SSRF blocked: localhost resolves to private IPv6 ::1")).toBe("blocked");
    expect(failureCategory("browser unavailable: no chromium")).toBe("browser_unavailable");
    expect(failureCategory("getaddrinfo ENOTFOUND example.invalid")).toBe("network");
    expect(failureCategory("yt-dlp not found")).toBe("not_found");
    expect(failureCategory("connect ECONNREFUSED 127.0.0.1:1")).toBe("network");
    expect(failureCategory("something odd")).toBe("error");
  });

  test("service.name defaults to webfrost; OTEL_SERVICE_NAME and resource attributes apply", () => {
    expect(resourceFromEnv({}).attributes["service.name"]).toBe("webfrost");
    expect(resourceFromEnv({ OTEL_SERVICE_NAME: "archive-1" }, "1.2.3").attributes).toMatchObject({
      "service.name": "archive-1",
      "service.version": "1.2.3",
    });
  });

  test("an unsupported protocol turns the signal off with a warning", async () => {
    const warnings: string[] = [];
    const backend = await createOtelBackend(
      { warn: (m) => warnings.push(m) },
      {},
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4317",
        OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
      },
    );
    expect(backend).toBeNull();
    expect(warnings.join("\n")).toContain("grpc is not supported");
  });
});

describe("pipeline spans and metrics", () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metrics,
    exportIntervalMillis: 3_600_000,
  });
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV = [
    "WEBFROST_ALLOW_PRIVATE_URLS",
    "WEBFROST_DOMAIN_DELAY_MS",
    "WEBFROST_OTEL_FULL_URLS",
  ];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          `<!doctype html><html><head><title>Frost</title></head><body><article><h1>Frost</h1><p>${"Ice keeps a long memory. ".repeat(40)}</p></article></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
    for (const key of ENV) savedEnv[key] = process.env[key];
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
    Reflect.deleteProperty(process.env, "WEBFROST_OTEL_FULL_URLS");
    const backend = await createOtelBackend(
      {},
      { spanExporter: spans, metricReader: reader, synchronous: true },
      {},
    );
    setTelemetryBackend(backend);
  });

  afterAll(async () => {
    await shutdownTelemetry();
    server.stop(true);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    spans.reset();
  });

  const byName = (all: ReadableSpan[], name: string) => all.filter((s) => s.name === name);
  const parentId = (span: ReadableSpan) => span.parentSpanContext?.spanId;

  test("a pipeline run is one trace: fetch, navigation, extractors, database", async () => {
    dir = join(tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const db = await openDb(dir);
    let snapshotId: number;
    try {
      snapshotId = await addUrl(db, `${baseUrl}/private/path?token=secret`, dir);
    } finally {
      await db.close();
    }
    const finished = spans.getFinishedSpans();

    const [run] = byName(finished, "snapshot.archive");
    expect(run).toBeDefined();
    if (!run) return;
    expect(run.attributes["webfrost.snapshot.id"]).toBe(snapshotId);
    expect(run.attributes["server.address"]).toBe("127.0.0.1");
    expect(run.attributes["webfrost.snapshot.status"]).toBe("done");
    expect(run.attributes["webfrost.extractors"]).toEqual(
      expect.arrayContaining(["html", "readability", "warc", "media"]),
    );
    // Only the host: no path, no query string, anywhere.
    for (const span of finished) {
      for (const value of Object.values(span.attributes)) {
        expect(String(value)).not.toContain("token=secret");
        expect(String(value)).not.toContain("/private/path");
      }
    }

    const runId = run.spanContext().spanId;
    const [fetchSpan] = byName(finished, "page.fetch");
    expect(fetchSpan && parentId(fetchSpan)).toBe(runId);
    expect(fetchSpan?.attributes["http.response.status_code"]).toBe(200);
    expect(fetchSpan?.attributes["http.response.body.size"]).toBeGreaterThan(100);

    const [navigation] = byName(finished, "browser.navigate");
    expect(navigation && parentId(navigation)).toBe(runId);

    for (const format of ["html", "readability", "warc", "media"]) {
      const [extractor] = byName(finished, `extractor.${format}`);
      expect(extractor && parentId(extractor)).toBe(runId);
      expect(extractor?.attributes["webfrost.extractor.format"]).toBe(format);
      expect(["ok", "failed", "timeout"]).toContain(
        String(extractor?.attributes["webfrost.extractor.outcome"]),
      );
    }
    const [html] = byName(finished, "extractor.html");
    expect(html?.attributes["webfrost.extractor.outcome"]).toBe("ok");
    expect(html?.attributes["webfrost.extractor.bytes"]).toBeGreaterThan(100);
    expect(html?.status.code).not.toBe(SpanStatusCode.ERROR);

    // Database spans: operation and table, no statement text or parameters.
    const insert = finished.find((s) => s.name === "INSERT archive_results");
    expect(insert).toBeDefined();
    expect(insert?.attributes).toMatchObject({
      "db.system.name": isSqliteRun ? "sqlite" : expect.any(String),
      "db.operation.name": "INSERT",
      "db.collection.name": "archive_results",
    });
    expect(Object.keys(insert?.attributes ?? {})).not.toContain("db.query.text");
    // Every span of the run is in the run's trace.
    const traceId = run.spanContext().traceId;
    for (const span of [fetchSpan, navigation, html, insert]) {
      expect(span?.spanContext().traceId).toBe(traceId);
    }

    await reader.forceFlush();
    const exported = metrics.getMetrics().flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
    const names = exported.map((m) => m.descriptor.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "webfrost.snapshots.finished",
        "webfrost.extractor.duration",
        "webfrost.archived.bytes",
        "db.client.operation.duration",
      ]),
    );
    const finishedMetric = exported.find(
      (m) => m.descriptor.name === "webfrost.snapshots.finished",
    );
    expect(finishedMetric?.dataPoints[0]?.attributes).toEqual({
      "webfrost.snapshot.status": "done",
    });
  }, 120_000);

  test("a queued job runs under the trace that queued it", async () => {
    dir = join(tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const runner = new JobRunner({ dir, concurrency: 1 });
    await withSpan("POST /api/snapshots", { kind: "server" }, async () => {
      const db = await openDb(dir);
      try {
        await runner.add(db, `${baseUrl}/queued`);
      } finally {
        await db.close();
      }
    });
    await runner.onIdle();
    const finished = spans.getFinishedSpans();
    const [request] = byName(finished, "POST /api/snapshots");
    const [enqueue] = byName(finished, "job_queue.enqueue");
    const [run] = byName(finished, "snapshot.archive");
    expect(request && enqueue && run).toBeTruthy();
    if (!request || !enqueue || !run) return;
    const requestId = request.spanContext().spanId;
    expect(parentId(enqueue)).toBe(requestId);
    expect(parentId(run)).toBe(requestId);
    expect(run.spanContext().traceId).toBe(request.spanContext().traceId);

    // A recovery sweep is traced too, even when it finds nothing.
    await runner.recoverPending();
    const [recover] = byName(spans.getFinishedSpans(), "job_queue.recover");
    expect(recover?.attributes["webfrost.jobs.adopted"]).toBe(0);

    // The job queue gauge reports both states.
    await reader.forceFlush();
    const gauge = metrics
      .getMetrics()
      .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))
      .filter((m) => m.descriptor.name === "webfrost.jobs")
      .at(-1);
    expect(gauge?.dataPoints.map((p) => p.attributes["webfrost.job.state"]).sort()).toEqual([
      "pending",
      "running",
    ]);
  }, 120_000);

  test("with WEBFROST_OTEL_FULL_URLS=true the full URL is recorded", async () => {
    process.env.WEBFROST_OTEL_FULL_URLS = "true";
    dir = join(tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const db = await openDb(dir);
    try {
      await addUrl(db, `${baseUrl}/full?x=1`, dir);
    } finally {
      await db.close();
      Reflect.deleteProperty(process.env, "WEBFROST_OTEL_FULL_URLS");
    }
    const [run] = byName(spans.getFinishedSpans(), "snapshot.archive");
    expect(run?.attributes["url.full"]).toBe(`${baseUrl}/full?x=1`);
    // The snapshot row is unaffected by any of this.
    const check = await openDb(dir);
    try {
      const row = await check.get<{ status: string }>(sql`SELECT status FROM snapshots LIMIT 1`);
      expect(row?.status).toBe("done");
    } finally {
      await check.close();
    }
  }, 120_000);
});
