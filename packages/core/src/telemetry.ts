/**
 * Optional OpenTelemetry export: the instrumentation points the rest of WebFrost calls.
 *
 * This module never imports OpenTelemetry. Until `initTelemetry()` finds an OTLP
 * endpoint in the environment and loads `./telemetry-otel` (a dynamic import), every
 * function here is a no-op that returns at once: no SDK in memory, nothing recorded,
 * nothing sent anywhere. WebFrost collects no telemetry of its own; this only sends
 * data to a collector the operator configured.
 *
 * Privacy: callers pass identifiers, hosts, formats, outcomes and sizes, never full
 * URLs (unless WEBFROST_OTEL_FULL_URLS=true), query strings, request headers, SQL
 * parameters or page content.
 */
import type { Dialect } from "kysely";

export type AttributeValue = string | number | boolean | string[];
export type Attributes = Record<string, AttributeValue | undefined>;

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

export interface SpanHandle {
  setAttributes(attributes: Attributes): void;
  /** Rename the span (the HTTP server span learns its route template after routing). */
  updateName(name: string): void;
  /** Mark the span failed. `category` is a short, low-cardinality reason (see `failureCategory`). */
  fail(error: unknown, category?: string): void;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  /**
   * The parent: a context returned by `captureContext()`. Omitted, the span is a child
   * of whatever span is active.
   */
  parent?: TraceContext | undefined;
  /** Incoming W3C trace context headers (`traceparent`, `tracestate`) to continue. */
  carrier?: Headers | undefined;
}

/** An opaque handle on a trace context, to parent work that runs later (a queued job). */
export type TraceContext = { readonly __traceContext: unique symbol };

/** Histograms and counters WebFrost records; names and units live in telemetry-otel.ts. */
export type MetricName =
  | "snapshots.finished"
  | "extractor.duration"
  | "archived.bytes"
  | "jobs.retries"
  | "jobs.recovered"
  | "jobs.abandoned"
  | "throttle.wait"
  | "http.server.duration"
  | "db.duration"
  | "db.transaction.retries";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** What `telemetry-otel.ts` installs. */
export interface TelemetryBackend {
  span<T>(name: string, options: SpanOptions, fn: (span: SpanHandle) => T): T;
  captureContext(): TraceContext | undefined;
  withContext<T>(ctx: TraceContext, fn: () => T): T;
  rootContext(): TraceContext;
  logFields(): { trace_id: string; span_id: string; trace_flags: string } | undefined;
  record(metric: MetricName, value: number, attributes?: Attributes): void;
  /** Report the number of jobs in a state each time metrics are collected. */
  observeJobs(source: () => { pending: number; running: number }): () => void;
  traceDialect(dialect: Dialect, system: string): Dialect;
  /** True when OTEL_LOGS_EXPORTER=otlp: log lines are exported as well. */
  readonly exportsLogs: boolean;
  emitLog(level: LogLevel, message: string, attributes?: Attributes): void;
  /** Flush everything buffered and stop the exporters. */
  shutdown(): Promise<void>;
}

let backend: TelemetryBackend | null = null;
let initializing: Promise<boolean> | null = null;

const NOOP_SPAN: SpanHandle = {
  setAttributes() {},
  updateName() {},
  fail() {},
};

/** The OTel variables that turn export on: an OTLP endpoint, for any signal. */
const ENDPOINT_VARS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
] as const;

/**
 * Whether the environment asks for OpenTelemetry export: an OTLP endpoint is set and
 * OTEL_SDK_DISABLED is not "true".
 */
export function telemetryConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return false;
  return ENDPOINT_VARS.some((name) => (env[name]?.trim() ?? "") !== "");
}

/** True once `initTelemetry()` has loaded the SDK. */
export function telemetryEnabled(): boolean {
  return backend !== null;
}

export interface InitTelemetryOptions {
  /** `service.version` on the resource. */
  serviceVersion?: string;
  /** Called with a warning when the configuration is unusable (export stays off). */
  warn?: (message: string) => void;
}

/**
 * Load the OpenTelemetry SDK and start exporting, if the environment asks for it.
 * Resolves to whether export is on. Safe to call more than once.
 */
export function initTelemetry(options: InitTelemetryOptions = {}): Promise<boolean> {
  if (backend) return Promise.resolve(true);
  if (initializing) return initializing;
  if (!telemetryConfigured()) return Promise.resolve(false);
  initializing = import("./telemetry-otel")
    .then(async (otel) => {
      const created = await otel.createOtelBackend(options);
      if (created) backend = created;
      return created !== null;
    })
    .catch((err: unknown) => {
      options.warn?.(
        `OpenTelemetry export disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    })
    .finally(() => {
      initializing = null;
    });
  return initializing;
}

/** Install a backend directly (tests use one with in-memory exporters). */
export function setTelemetryBackend(next: TelemetryBackend | null): void {
  backend = next;
}

/** Flush and stop the exporters; resolves after `timeoutMs` at the latest. Never throws. */
export async function shutdownTelemetry(timeoutMs = 5_000): Promise<void> {
  const current = backend;
  if (!current) return;
  backend = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      current.shutdown().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `fn` inside a span. Sync or async: a returned promise ends the span when it
 * settles. A thrown error or a rejection marks the span failed and is rethrown.
 */
export function withSpan<T>(name: string, options: SpanOptions, fn: (span: SpanHandle) => T): T {
  if (!backend) return fn(NOOP_SPAN);
  return backend.span(name, options, fn);
}

/** The active trace context, to parent work started later (`withSpan({ parent })`). */
export function captureContext(): TraceContext | undefined {
  return backend?.captureContext();
}

/** Run `fn` with `ctx` as the active context. */
export function withTraceContext<T>(ctx: TraceContext | undefined, fn: () => T): T {
  if (!backend || !ctx) return fn();
  return backend.withContext(ctx, fn);
}

/**
 * Run `fn` outside any trace: for timers and background loops started from inside a
 * span (a request), which would otherwise keep adding to that span's trace forever.
 */
export function withoutTraceContext<T>(fn: () => T): T {
  if (!backend) return fn();
  return backend.withContext(backend.rootContext(), fn);
}

/** trace_id / span_id of the active span, for log lines; empty when there is none. */
export function traceLogFields(): Record<string, string> {
  return backend?.logFields() ?? {};
}

/** Add to a counter or record into a histogram. */
export function recordMetric(metric: MetricName, value: number, attributes?: Attributes): void {
  backend?.record(metric, value, attributes);
}

/** Observe a job runner's queue for the `webfrost.jobs` gauge. Returns an unregister function. */
export function observeJobs(source: () => { pending: number; running: number }): () => void {
  return backend?.observeJobs(source) ?? (() => {});
}

/** Wrap a Kysely dialect so each query gets a span; returns it unchanged when export is off. */
export function traceDialect(dialect: Dialect, system: string): Dialect {
  return backend ? backend.traceDialect(dialect, system) : dialect;
}

/** Whether log lines are exported (OTEL_LOGS_EXPORTER=otlp). */
export function telemetryExportsLogs(): boolean {
  return backend?.exportsLogs === true;
}

/** Export one log line through OTLP when OTEL_LOGS_EXPORTER=otlp. */
export function emitTelemetryLog(level: LogLevel, message: string, attributes?: Attributes): void {
  if (backend?.exportsLogs) backend.emitLog(level, message, attributes);
}

/** Record full URLs (`url.full`) on spans instead of only the host: WEBFROST_OTEL_FULL_URLS=true. */
export function recordFullUrls(): boolean {
  return process.env.WEBFROST_OTEL_FULL_URLS === "true";
}

/** The host of a URL, for span attributes; undefined when it does not parse. */
export function urlHost(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attributes that describe a target URL: `server.address` always, `url.full` only
 * with WEBFROST_OTEL_FULL_URLS=true.
 */
export function urlAttributes(url: string): Attributes {
  return {
    "server.address": urlHost(url),
    ...(recordFullUrls() ? { "url.full": url } : {}),
  };
}

/**
 * A short, low-cardinality reason for a failure, from its message: what span
 * attributes and metrics record instead of the message itself.
 */
export function failureCategory(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout")) return "timeout";
  if (m.includes("abort")) return "aborted";
  if (
    m.startsWith("blocked") ||
    m.includes("ssrf") ||
    m.includes("non-public") ||
    m.includes("private address")
  )
    return "blocked";
  if (m.includes("browser unavailable")) return "browser_unavailable";
  if (m.includes("not found") || m.includes("enoent")) return "not_found";
  if (/\bhttp\b.*\b[45]\d\d\b|status \d{3}/.test(m)) return "http_status";
  if (/econn|enotfound|eai_again|network|dns|socket|tls|certificate/.test(m)) return "network";
  if (m.includes("too large") || m.includes("exceeds")) return "too_large";
  return "error";
}
