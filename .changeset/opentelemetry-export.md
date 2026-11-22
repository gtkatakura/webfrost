---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/cli": minor
---

Optional OpenTelemetry export, off by default. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or a per-signal endpoint) and the server, `webfrost serve`, the CLI, the Docker image and the binary send traces and metrics over OTLP/HTTP to your own collector; `OTEL_LOGS_EXPORTER=otlp` adds the log lines. The standard `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER(_ARG)` and `OTEL_SDK_DISABLED` variables apply. Without an endpoint the OpenTelemetry SDK is not loaded at all.

- Traces: a server span per request named after its route, a span per archive run (parented to the request or schedule tick that queued it) with spans for the page fetch, the browser navigation, each extractor, yt-dlp and the database statements, and spans for the recovery sweep and scheduler ticks.
- Metrics: snapshots finished by status, extractor duration by format and outcome, bytes archived, the job queue, retries and recovered leases, per-host throttle waits, HTTP request duration and database operation duration.
- Server log lines carry `trace_id` and `span_id` while a span is active.
- Only hosts are recorded for archived pages (full URLs with `WEBFROST_OTEL_FULL_URLS=true`); never query strings, headers, bodies or SQL parameters.
- Buffered data is flushed on graceful shutdown, for at most 5 seconds.

See the new [Observability](https://webfrost.dev/docs/guides/observability) guide.
