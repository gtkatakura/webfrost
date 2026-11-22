import { type SpanHandle, recordMetric, telemetryEnabled, withSpan } from "@webfrost/core";
import { Elysia } from "elysia";

/** The server span of each request in flight, so the route hook can name it. */
const requestSpans = new WeakMap<Request, { span: SpanHandle; route?: string }>();

/**
 * One server span per HTTP request, plus the `http.server.request.duration` metric,
 * when OpenTelemetry export is on (a no-op otherwise: the wrapper hands Elysia its
 * own handler back).
 *
 * The span is named after the route template (`GET /api/snapshots/:id`), never the
 * concrete path, and records the method, route, status and scheme only: no query
 * string, no headers (Authorization, cookies) and no body. An incoming W3C
 * `traceparent` header is continued, so a caller's trace includes the request.
 */
export const telemetryPlugin = new Elysia({ name: "webfrost-telemetry" })
  .wrap(
    // `wrap` sees the whole request, so the span is active for every hook and handler.
    (handle) => {
      if (!telemetryEnabled()) return handle;
      const fetch = handle as unknown as (request: Request) => Response | Promise<Response>;
      return ((request: Request) => tracedRequest(request, fetch)) as unknown as typeof handle;
    },
  )
  .onTransform({ as: "global" }, ({ request, route: template }) => {
    const entry = requestSpans.get(request);
    if (!entry || !template) return;
    // A group's root route is registered as "/prefix/": report it as "/prefix".
    const route = template.length > 1 ? template.replace(/\/+$/, "") : template;
    entry.route = route;
    entry.span.updateName(`${request.method} ${route}`);
    entry.span.setAttributes({ "http.route": route });
  });

function tracedRequest(
  request: Request,
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const started = performance.now();
  const method = request.method;
  const scheme = request.url.startsWith("https:") ? "https" : "http";
  return withSpan(
    method,
    {
      kind: "server",
      carrier: request.headers,
      attributes: { "http.request.method": method, "url.scheme": scheme },
    },
    async (span) => {
      const entry: { span: SpanHandle; route?: string } = { span };
      requestSpans.set(request, entry);
      let status = 500;
      try {
        const response = await fetch(request);
        status = response.status;
        return response;
      } finally {
        span.setAttributes({ "http.response.status_code": status });
        if (status >= 500) span.fail(undefined, String(status));
        recordMetric("http.server.duration", (performance.now() - started) / 1000, {
          "http.request.method": method,
          "http.route": entry.route,
          "http.response.status_code": status,
          "url.scheme": scheme,
        });
      }
    },
  );
}
