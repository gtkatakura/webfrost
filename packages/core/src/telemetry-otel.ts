/**
 * The OpenTelemetry side of telemetry.ts. Loaded only by `initTelemetry()` (a dynamic
 * import) when an OTLP endpoint is configured, so a process that does not export
 * telemetry never evaluates any of the SDK.
 *
 * Instrumented by hand: Node auto-instrumentation (require hooks) does not work in
 * Bun, and the few places worth tracing are WebFrost's own code anyway.
 *
 * Configured by the standard variables: OTEL_EXPORTER_OTLP_ENDPOINT (or the
 * per-signal *_TRACES_/*_METRICS_/*_LOGS_ENDPOINT), OTEL_EXPORTER_OTLP_HEADERS,
 * OTEL_EXPORTER_OTLP_PROTOCOL (http/protobuf only), OTEL_SERVICE_NAME,
 * OTEL_RESOURCE_ATTRIBUTES, OTEL_TRACES_SAMPLER(_ARG), OTEL_TRACES_EXPORTER /
 * OTEL_METRICS_EXPORTER (`none` turns one off), OTEL_LOGS_EXPORTER (`otlp` turns log
 * export on), OTEL_METRIC_EXPORT_INTERVAL.
 */
import {
  type Context,
  type Counter,
  type Histogram,
  ROOT_CONTEXT,
  SeverityNumber,
  type Span,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { type Resource, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  type MetricReader,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  Driver,
  QueryResult,
  TransactionSettings,
} from "kysely";
import type {
  Attributes,
  InitTelemetryOptions,
  LogLevel,
  MetricName,
  SpanHandle,
  SpanOptions,
  TelemetryBackend,
  TraceContext,
  SpanKind as WebfrostSpanKind,
} from "./telemetry";

const SCOPE = "webfrost";

/** Exporters to use instead of OTLP: tests pass in-memory ones. */
export interface OtelOverrides {
  spanExporter?: SpanExporter;
  metricReader?: MetricReader;
  logExporter?: LogRecordExporter;
  /** Export spans and log records one by one, as they end (tests). */
  synchronous?: boolean;
}

type Env = Record<string, string | undefined>;

function envValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function signalEndpoint(env: Env, signal: "TRACES" | "METRICS" | "LOGS"): string | undefined {
  return (
    envValue(env, `OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`) ??
    envValue(env, "OTEL_EXPORTER_OTLP_ENDPOINT")
  );
}

function signalProtocol(env: Env, signal: "TRACES" | "METRICS" | "LOGS"): string {
  return (
    envValue(env, `OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`) ??
    envValue(env, "OTEL_EXPORTER_OTLP_PROTOCOL") ??
    "http/protobuf"
  ).toLowerCase();
}

/** OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG, as the specification defines them. */
export function samplerFromEnv(env: Env = process.env, warn?: (message: string) => void): Sampler {
  const name = (envValue(env, "OTEL_TRACES_SAMPLER") ?? "parentbased_always_on").toLowerCase();
  const rawArg = envValue(env, "OTEL_TRACES_SAMPLER_ARG");
  const ratio = () => {
    const value = rawArg === undefined ? 1 : Number(rawArg);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      warn?.(`OTEL_TRACES_SAMPLER_ARG=${rawArg} is not a ratio between 0 and 1; using 1`);
      return 1;
    }
    return value;
  };
  switch (name) {
    case "always_on":
      return new AlwaysOnSampler();
    case "always_off":
      return new AlwaysOffSampler();
    case "traceidratio":
      return new TraceIdRatioBasedSampler(ratio());
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio()) });
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    default:
      warn?.(`OTEL_TRACES_SAMPLER=${name} is not supported; using parentbased_always_on`);
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
}

/** service.name from OTEL_SERVICE_NAME, then OTEL_RESOURCE_ATTRIBUTES, then "webfrost". */
export function resourceFromEnv(env: Env, serviceVersion?: string): Resource {
  const detected = envDetector.detect();
  const fromAttributes = detected.attributes?.["service.name"];
  const serviceName =
    envValue(env, "OTEL_SERVICE_NAME") ??
    (typeof fromAttributes === "string" ? fromAttributes : undefined) ??
    "webfrost";
  return resourceFromAttributes({
    ...(detected.attributes ?? {}),
    "service.name": serviceName,
    ...(serviceVersion ? { "service.version": serviceVersion } : {}),
    "process.runtime.name": "bun",
    "process.runtime.version": Bun.version,
  });
}

const KINDS: Record<WebfrostSpanKind, SpanKind> = {
  internal: SpanKind.INTERNAL,
  server: SpanKind.SERVER,
  client: SpanKind.CLIENT,
  producer: SpanKind.PRODUCER,
  consumer: SpanKind.CONSUMER,
};

function clean(
  attributes: Attributes | undefined,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  if (!attributes) return out;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

interface OtelSpanHandle extends SpanHandle {
  failed: boolean;
}

function handleFor(span: Span): OtelSpanHandle {
  return {
    failed: false,
    setAttributes: (attributes) => {
      span.setAttributes(clean(attributes));
    },
    updateName: (name) => {
      span.updateName(name);
    },
    fail(error, category) {
      this.failed = true;
      // The exception message can quote a URL; only its type and category are recorded.
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute(
        "error.type",
        category ?? (error instanceof Error ? error.constructor.name : "error"),
      );
    },
  };
}

const headerGetter = {
  get: (carrier: Headers, key: string) => carrier.get(key) ?? undefined,
  keys: (carrier: Headers) => [...carrier.keys()],
};

/** Duration histograms in seconds, with the semantic-convention bucket boundaries. */
const SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10, 30, 60, 120, 300,
];

const DB_SYSTEMS: Record<string, string> = {
  sqlite: "sqlite",
  postgres: "postgresql",
  mysql: "mysql",
};

/** Operation and table of a compiled statement, from its text (parameters are placeholders). */
export function describeStatement(sqlText: string): { operation?: string; table?: string } {
  const text = sqlText.replace(/\s+/g, " ").trim();
  const op =
    /^(?:with\b.*?\)\s*)?(select|insert|update|delete|replace|create|drop|alter|pragma|begin|commit|rollback|savepoint|release)\b/i.exec(
      text,
    );
  const operation = op?.[1]?.toUpperCase();
  if (!operation) return {};
  const identifier = String.raw`["\`\[]?([A-Za-z_][\w]*)["\`\]]?`;
  let pattern: RegExp | undefined;
  switch (operation) {
    case "SELECT":
    case "DELETE":
      pattern = new RegExp(String.raw`\bfrom\s+${identifier}`, "i");
      break;
    case "INSERT":
    case "REPLACE":
      pattern = new RegExp(String.raw`\binto\s+${identifier}`, "i");
      break;
    case "UPDATE":
      pattern = new RegExp(String.raw`^(?:with\b.*?\)\s*)?update\s+${identifier}`, "i");
      break;
  }
  const table = pattern?.exec(text)?.[1];
  return table ? { operation, table } : { operation };
}

/**
 * Build the OTel backend from the environment. Resolves to null when every signal is
 * turned off or unusable (a warning says why).
 */
export async function createOtelBackend(
  options: InitTelemetryOptions = {},
  overrides: OtelOverrides = {},
  env: Env = process.env,
): Promise<TelemetryBackend | null> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const resource = resourceFromEnv(env, options.serviceVersion);

  const usable = (signal: "TRACES" | "METRICS" | "LOGS"): boolean => {
    if (!signalEndpoint(env, signal)) return false;
    const protocol = signalProtocol(env, signal);
    if (protocol !== "http/protobuf") {
      warn(
        `OTEL_EXPORTER_OTLP_PROTOCOL=${protocol} is not supported by WebFrost; ${signal.toLowerCase()} are not exported. Use http/protobuf (port 4318 on most collectors).`,
      );
      return false;
    }
    return true;
  };
  const exporterOff = (name: string) => envValue(env, name)?.toLowerCase() === "none";

  const tracesOn =
    overrides.spanExporter !== undefined ||
    (!exporterOff("OTEL_TRACES_EXPORTER") && usable("TRACES"));
  const metricsOn =
    overrides.metricReader !== undefined ||
    (!exporterOff("OTEL_METRICS_EXPORTER") && usable("METRICS"));
  const logsOn =
    overrides.logExporter !== undefined ||
    (envValue(env, "OTEL_LOGS_EXPORTER")?.toLowerCase() === "otlp" && usable("LOGS"));
  if (!tracesOn && !metricsOn && !logsOn) return null;

  // Context: AsyncLocalStorage, so a span stays active across awaits.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  const propagator = new W3CTraceContextPropagator();
  propagation.setGlobalPropagator(propagator);

  let spanProcessor: SpanProcessor | undefined;
  let tracerProvider: TracerProvider | undefined;
  if (tracesOn) {
    const exporter = overrides.spanExporter ?? new OTLPTraceExporter();
    spanProcessor = overrides.synchronous
      ? new SimpleSpanProcessor({ exporter })
      : new BatchSpanProcessor({ exporter });
    tracerProvider = new TracerProvider({
      resource,
      sampler: samplerFromEnv(env, warn),
      spanProcessors: [spanProcessor],
    });
    trace.setGlobalTracerProvider(tracerProvider);
  }
  const tracer = (tracerProvider ?? trace.getTracerProvider()).getTracer(SCOPE);

  let meterProvider: MeterProvider | undefined;
  if (metricsOn) {
    const interval = Number(envValue(env, "OTEL_METRIC_EXPORT_INTERVAL") ?? 60_000);
    const reader =
      overrides.metricReader ??
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number.isFinite(interval) && interval > 0 ? interval : 60_000,
      });
    meterProvider = new MeterProvider({ resource, readers: [reader] });
  }

  let loggerProvider: LoggerProvider | undefined;
  if (logsOn) {
    const exporter = overrides.logExporter ?? new OTLPLogExporter();
    const processor: LogRecordProcessor = overrides.synchronous
      ? new SimpleLogRecordProcessor({ exporter })
      : new BatchLogRecordProcessor({ exporter });
    loggerProvider = new LoggerProvider({ resource, processors: [processor] });
  }
  const otelLogger = loggerProvider?.getLogger(SCOPE);

  // Instruments, created on first use.
  const meter = meterProvider?.getMeter(SCOPE);
  const instruments = new Map<MetricName, Counter | Histogram>();
  const instrument = (name: MetricName): Counter | Histogram | undefined => {
    if (!meter) return undefined;
    const existing = instruments.get(name);
    if (existing) return existing;
    let created: Counter | Histogram;
    const seconds = (otelName: string, description: string) =>
      meter.createHistogram(otelName, {
        description,
        unit: "s",
        advice: { explicitBucketBoundaries: SECONDS_BUCKETS },
      });
    switch (name) {
      case "snapshots.finished":
        created = meter.createCounter("webfrost.snapshots.finished", {
          description: "Snapshot pipeline runs that finished, by final status",
          unit: "{snapshot}",
        });
        break;
      case "extractor.duration":
        created = seconds(
          "webfrost.extractor.duration",
          "Time one extractor took, by format and outcome",
        );
        break;
      case "archived.bytes":
        created = meter.createCounter("webfrost.archived.bytes", {
          description: "Bytes of archived output stored, by format",
          unit: "By",
        });
        break;
      case "jobs.retries":
        created = meter.createCounter("webfrost.jobs.retries", {
          description: "Archive jobs run again after an interrupted attempt",
          unit: "{job}",
        });
        break;
      case "jobs.recovered":
        created = meter.createCounter("webfrost.jobs.leases_recovered", {
          description: "Jobs adopted from a lease that went stale (crash, restart, stalled worker)",
          unit: "{job}",
        });
        break;
      case "jobs.abandoned":
        created = meter.createCounter("webfrost.jobs.abandoned", {
          description: "Jobs given up on after being interrupted too many times",
          unit: "{job}",
        });
        break;
      case "throttle.wait":
        created = seconds(
          "webfrost.throttle.wait.duration",
          "Time a run waited for its host's politeness slot",
        );
        break;
      case "http.server.duration":
        created = seconds("http.server.request.duration", "Duration of HTTP server requests");
        break;
      case "db.duration":
        created = seconds("db.client.operation.duration", "Duration of database operations");
        break;
      case "db.transaction.retries":
        created = meter.createCounter("webfrost.db.transaction.retries", {
          description: "Transactions retried after a deadlock or a busy database",
          unit: "{retry}",
        });
        break;
    }
    instruments.set(name, created);
    return created;
  };

  const recordValue = (metric: MetricName, value: number, attributes?: Attributes): void => {
    const target = instrument(metric);
    if (!target) return;
    if ("add" in target) target.add(value, clean(attributes));
    else (target as Histogram).record(value, clean(attributes));
  };

  // The job gauge: summed over every runner in the process.
  const jobSources = new Set<() => { pending: number; running: number }>();
  if (meter) {
    meter
      .createObservableGauge("webfrost.jobs", {
        description: "Archive jobs in this process, queued (pending) or running",
        unit: "{job}",
      })
      .addCallback((result) => {
        let pending = 0;
        let running = 0;
        for (const source of jobSources) {
          const counts = source();
          pending += counts.pending;
          running += counts.running;
        }
        result.observe(pending, { "webfrost.job.state": "pending" });
        result.observe(running, { "webfrost.job.state": "running" });
      });
  }

  const span = <T>(name: string, spanOptions: SpanOptions, fn: (span: SpanHandle) => T): T => {
    let parent: Context = context.active();
    if (spanOptions.parent) parent = spanOptions.parent as unknown as Context;
    if (spanOptions.carrier)
      parent = propagation.extract(parent, spanOptions.carrier, headerGetter);
    return tracer.startActiveSpan(
      name,
      { kind: KINDS[spanOptions.kind ?? "internal"], attributes: clean(spanOptions.attributes) },
      parent,
      (otelSpan) => {
        const handle = handleFor(otelSpan);
        let result: T;
        try {
          result = fn(handle);
        } catch (err) {
          if (!handle.failed) handle.fail(err);
          otelSpan.end();
          throw err;
        }
        if (result && typeof (result as { then?: unknown }).then === "function") {
          return (result as unknown as Promise<unknown>).then(
            (value) => {
              otelSpan.end();
              return value;
            },
            (err: unknown) => {
              if (!handle.failed) handle.fail(err);
              otelSpan.end();
              throw err;
            },
          ) as T;
        }
        otelSpan.end();
        return result;
      },
    );
  };

  const traceDialect = (dialect: Dialect, system: string): Dialect => {
    const dbSystem = DB_SYSTEMS[system] ?? system;
    return {
      createAdapter: () => dialect.createAdapter(),
      createQueryCompiler: () => dialect.createQueryCompiler(),
      createIntrospector: (db) => dialect.createIntrospector(db),
      createDriver: () => tracedDriver(dialect.createDriver(), dbSystem),
    };
  };

  const tracedDriver = (inner: Driver, dbSystem: string): Driver => {
    const unwrap = new WeakMap<DatabaseConnection, DatabaseConnection>();
    const raw = (connection: DatabaseConnection) => unwrap.get(connection) ?? connection;
    const wrap = (connection: DatabaseConnection): DatabaseConnection => {
      const wrapped: DatabaseConnection = {
        executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
          const { operation, table } = describeStatement(query.sql);
          // Transaction control statements are noise next to the statements inside them.
          if (
            !operation ||
            ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "PRAGMA"].includes(operation)
          ) {
            return connection.executeQuery<R>(query);
          }
          const attributes = {
            "db.system.name": dbSystem,
            "db.operation.name": operation,
            "db.collection.name": table,
          };
          const started = performance.now();
          // Statements outside any span (lease heartbeats, say) would each start a trace
          // of their own: they are timed, not traced.
          const run = () => connection.executeQuery<R>(query);
          const pending = trace.getSpan(context.active())
            ? span(table ? `${operation} ${table}` : operation, { kind: "client", attributes }, run)
            : run();
          return pending.finally(() => {
            recordValue("db.duration", (performance.now() - started) / 1000, attributes);
          });
        },
        streamQuery: (query, chunkSize) => connection.streamQuery(query, chunkSize),
      };
      unwrap.set(wrapped, connection);
      return wrapped;
    };
    const driver: Driver = {
      init: () => inner.init(),
      acquireConnection: async () => wrap(await inner.acquireConnection()),
      beginTransaction: (connection: DatabaseConnection, settings: TransactionSettings) =>
        inner.beginTransaction(raw(connection), settings),
      commitTransaction: (connection: DatabaseConnection) =>
        inner.commitTransaction(raw(connection)),
      rollbackTransaction: (connection: DatabaseConnection) =>
        inner.rollbackTransaction(raw(connection)),
      releaseConnection: (connection: DatabaseConnection) =>
        inner.releaseConnection(raw(connection)),
      destroy: () => inner.destroy(),
    };
    if (inner.savepoint) {
      const savepoint = inner.savepoint.bind(inner);
      driver.savepoint = (connection, name, compile) => savepoint(raw(connection), name, compile);
    }
    if (inner.rollbackToSavepoint) {
      const rollbackTo = inner.rollbackToSavepoint.bind(inner);
      driver.rollbackToSavepoint = (connection, name, compile) =>
        rollbackTo(raw(connection), name, compile);
    }
    if (inner.releaseSavepoint) {
      const release = inner.releaseSavepoint.bind(inner);
      driver.releaseSavepoint = (connection, name, compile) =>
        release(raw(connection), name, compile);
    }
    return driver;
  };

  const SEVERITY: Record<LogLevel, SeverityNumber> = {
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
  };

  return {
    span,
    captureContext: () => context.active() as unknown as TraceContext,
    withContext: (ctx, fn) => context.with(ctx as unknown as Context, fn),
    rootContext: () => ROOT_CONTEXT as unknown as TraceContext,
    logFields: () => {
      const active = trace.getActiveSpan()?.spanContext();
      if (!active) return undefined;
      return {
        trace_id: active.traceId,
        span_id: active.spanId,
        trace_flags: `0${active.traceFlags.toString(16)}`,
      };
    },
    record: recordValue,
    observeJobs: (source) => {
      jobSources.add(source);
      return () => jobSources.delete(source);
    },
    traceDialect,
    exportsLogs: otelLogger !== undefined,
    emitLog: (level, message, attributes) => {
      otelLogger?.emit({
        severityNumber: SEVERITY[level],
        severityText: level.toUpperCase(),
        body: message,
        attributes: clean(attributes),
        context: context.active(),
      });
    },
    shutdown: async () => {
      await Promise.allSettled([
        tracerProvider?.shutdown(),
        meterProvider?.shutdown(),
        loggerProvider?.shutdown(),
      ]);
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
}
