import {
  type TelemetryAttributes,
  emitTelemetryLog,
  telemetryExportsLogs,
  traceLogFields,
} from "@webfrost/core";
import pino from "pino";

type ExportLevel = "debug" | "info" | "warn" | "error";

/** pino's numeric levels, as OpenTelemetry severities. */
function exportLevel(level: number): ExportLevel {
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  return "debug";
}

/** A pino call's arguments (`(obj?, msg?, ...)`) as an OTLP log record: message plus scalar fields. */
export function logRecordFromArgs(args: unknown[]): {
  message: string;
  attributes: TelemetryAttributes;
} {
  const attributes: TelemetryAttributes = {};
  let rest = args;
  const first = args[0];
  if (first !== null && typeof first === "object" && !(first instanceof Error)) {
    for (const [key, value] of Object.entries(first)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        attributes[key] = value;
      } else if (value instanceof Error) {
        attributes["exception.type"] = value.name;
        attributes["exception.message"] = value.message;
      }
    }
    rest = args.slice(1);
  } else if (first instanceof Error) {
    attributes["exception.type"] = first.name;
    attributes["exception.message"] = first.message;
    rest = args.slice(1);
  }
  const message = rest.length > 0 ? String(rest[0]) : "";
  return { message, attributes };
}

// WEBFROST_LOG_LEVEL is the documented name (shared with the CLI); LOG_LEVEL is kept
// as a fallback for existing deployments.
export const logger = pino({
  level: process.env.WEBFROST_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info",
  // trace_id / span_id of the active span on every line; nothing when export is off.
  mixin: () => traceLogFields(),
  hooks: {
    logMethod(args, method, level) {
      // OTEL_LOGS_EXPORTER=otlp: the line goes to the collector as well as to stdout.
      if (telemetryExportsLogs()) {
        const { message, attributes } = logRecordFromArgs(args);
        emitTelemetryLog(exportLevel(level), message, attributes);
      }
      method.apply(this, args);
    },
  },
});
