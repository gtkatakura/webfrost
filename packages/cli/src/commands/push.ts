import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleError, createStorageBackend, exportSnapshotBundle } from "@webfrost/core";
import { type Command, type Context, parseHttpUrl, parseId } from "../cli";
import { CliError, UsageError } from "../errors";
import { printJson, withDb } from "./shared";

/**
 * Text from the server, safe to print: control characters (terminal escape sequences, carriage
 * returns that overwrite the line) are replaced, and it is cut to `max` characters.
 */
export function printable(text: string, max = 200): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, max);
}

/** True for a loopback host, where plain HTTP never leaves the machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** The server refused an upload; `status` is its HTTP status (0 when it could not be reached). */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * The server's base URL from `--to`/`--from`: http(s) only, and plain HTTP only to this machine or with
 * --insecure (warned about), since the API key travels with every request.
 */
export function serverBase(
  ctx: Context,
  raw: string | undefined,
  flag: string,
  path: string[],
): URL {
  if (!raw) throw new UsageError(`Missing --${flag} <url>: the WebFrost server.`, path);
  const base = parseHttpUrl(raw, path);
  if (base.protocol === "http:" && !isLoopbackHost(base.hostname)) {
    if (!ctx.bool("insecure")) {
      throw new UsageError(
        `${base.origin} is plain HTTP: the API key and the snapshot would travel unencrypted. Use https, or pass --insecure if this network is trusted.`,
        path,
      );
    }
    ctx.logger.warn(
      `${base.origin} is plain HTTP (--insecure): the API key and the snapshot travel unencrypted.`,
    );
  }
  return base;
}

/** WEBFROST_API_KEY, which is only ever read from the environment. */
export function requireApiKey(command: string): string {
  const apiKey = process.env.WEBFROST_API_KEY;
  if (!apiKey) {
    throw new CliError(
      `WEBFROST_API_KEY is not set. Create an API key on the server (Settings > API keys) and export it: WEBFROST_API_KEY=wf_... webfrost ${command} ...`,
    );
  }
  return apiKey;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Bundles smaller than this upload without a progress line. */
const PROGRESS_MIN_BYTES = 1024 * 1024;

export async function exportBundle(ctx: Context, id: number, path: string): Promise<number> {
  try {
    const { bytes } = await withDb(ctx, (db) =>
      exportSnapshotBundle(db, createStorageBackend(ctx.dir), id, path),
    );
    return bytes;
  } catch (err) {
    if (err instanceof BundleError) throw new CliError(err.message);
    throw err;
  }
}

export const exportCommand: Command = {
  kind: "command",
  name: "export",
  summary: "Write a snapshot to a bundle file (ZIP) that another archive can import",
  description:
    "Write a finished snapshot (its files, results and tag names) to one ZIP file. Import it on a server with POST /api/v1/snapshots/import or `webfrost push`, or into another local archive with `webfrost import <file>`.",
  args: [{ name: "snapshot-id", description: "The snapshot to export" }],
  options: {
    output: {
      type: "string",
      short: "o",
      value: "file",
      description: "Where to write the bundle (default: snapshot-<id>.zip)",
    },
    json: { type: "boolean", description: "Print JSON: { id, path, bytes }" },
  },
  examples: ["webfrost export 12", "webfrost export 12 -o talk.zip --json"],
  async run(ctx) {
    const id = parseId(ctx.args[0] ?? "", "snapshot id", ["export"]);
    const path = ctx.string("output") ?? `snapshot-${id}.zip`;
    const bytes = await exportBundle(ctx, id, path);
    if (ctx.bool("json")) printJson({ id, path, bytes });
    else ctx.logger.info(`Exported snapshot ${id} to ${path} (${formatBytes(bytes)})`);
    return 0;
  },
};

interface PushOutcome {
  id: number;
  ok: boolean;
  remote?: { id: number; url: string; status: string };
  bytes?: number;
  error?: string;
}

/** A body that reports how much of it was read. */
function withProgress(path: string, total: number, report: (sent: number) => void) {
  const reader = Bun.file(path).stream().getReader();
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      sent += value.length;
      report(Math.min(sent, total));
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function upload(
  ctx: Context,
  endpoint: string,
  apiKey: string,
  id: number,
  path: string,
  bytes: number,
): Promise<{ id: number; url: string; status: string; replaced?: number }> {
  const showProgress = !ctx.quiet && process.stderr.isTTY === true && bytes >= PROGRESS_MIN_BYTES;
  const report = (sent: number) => {
    const pct = Math.floor((sent / bytes) * 100);
    process.stderr.write(
      `\rUploading snapshot ${id}: ${pct}% (${formatBytes(sent)} / ${formatBytes(bytes)})`,
    );
  };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/zip",
        "content-length": String(bytes),
      },
      body: showProgress ? withProgress(path, bytes, report) : Bun.file(path),
      // The key must never follow a redirect to another host.
      redirect: "manual",
    });
  } catch (err) {
    throw new UploadError(
      `cannot reach ${new URL(endpoint).origin}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  } finally {
    if (showProgress) process.stderr.write("\n");
  }

  const text = await res.text();
  let body: { id?: number; url?: string; status?: string; replaced?: number; error?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a proxy's error page): reported by status below.
  }
  if (res.status === 201 && typeof body.id === "number") {
    return {
      id: body.id,
      url: printable(String(body.url), 8192),
      status: printable(String(body.status)),
      ...(typeof body.replaced === "number" ? { replaced: body.replaced } : {}),
    };
  }
  if (res.status >= 300 && res.status < 400) {
    throw new UploadError(
      `the server answered with a redirect (HTTP ${res.status}); pass its final URL`,
      res.status,
    );
  }
  if (res.status === 401)
    throw new UploadError("the server rejected WEBFROST_API_KEY (HTTP 401)", 401);
  if (res.status === 413) {
    throw new UploadError(
      `the bundle is larger than the server accepts (HTTP 413; see WEBFROST_IMPORT_BUNDLE_MAX_BYTES, or a proxy's upload limit)`,
      413,
    );
  }
  throw new UploadError(
    `the server refused it: ${printable(typeof body.error === "string" ? body.error : text) || "no details"} (HTTP ${res.status})`,
    res.status,
  );
}

export const pushCommand: Command = {
  kind: "command",
  name: "push",
  summary: "Send snapshots archived here to a WebFrost server",
  description:
    "Export each snapshot as a bundle and upload it to a server, which stores it as a new snapshot (new id) with the same files, results and tags. Use it when the server cannot archive a page itself, or to archive on a laptop and keep everything on the server.",
  args: [{ name: "snapshot-id", description: "One or more snapshots to send", variadic: true }],
  options: {
    to: {
      type: "string",
      value: "url",
      description: "The server's base URL, e.g. https://archive.example.com",
    },
    insecure: {
      type: "boolean",
      description:
        "Allow a plain-HTTP --to URL that is not this machine (the key travels unencrypted)",
    },
    json: {
      type: "boolean",
      description:
        "Print JSON: one { id, ok, remote: { id, url, status }, bytes, error } per snapshot",
    },
  },
  notes: `
Environment:
  WEBFROST_API_KEY  An API key of the server (Settings > API keys). Read from the
                    environment only, never a flag, so it stays out of shell history
                    and process lists.

Exit codes:
  0  every snapshot was stored on the server
  1  at least one could not be exported or was refused (the others are still sent)
  2  usage error`,
  examples: [
    "WEBFROST_API_KEY=wf_... webfrost push 12 --to https://archive.example.com",
    "webfrost push 12 13 14 --to https://archive.example.com --json",
    "webfrost push 12 --to http://192.168.1.20:3000 --insecure",
  ],
  async run(ctx) {
    const ids = ctx.args.map((raw) => parseId(raw, "snapshot id", ["push"]));
    const base = serverBase(ctx, ctx.string("to"), "to", ["push"]);
    const apiKey = requireApiKey("push");
    const endpoint = `${base.href.replace(/\/+$/, "")}/api/v1/snapshots/import`;

    const outcomes: PushOutcome[] = [];
    const tmp = mkdtempSync(join(tmpdir(), "webfrost-push-"));
    try {
      for (const id of ids) {
        const path = join(tmp, `snapshot-${id}.zip`);
        try {
          const bytes = await exportBundle(ctx, id, path);
          const remote = await upload(ctx, endpoint, apiKey, id, path, bytes);
          outcomes.push({ id, ok: true, remote, bytes });
          if (!ctx.bool("json")) {
            ctx.logger.info(
              `Pushed snapshot ${id} (${formatBytes(bytes)}): snapshot ${remote.id} on ${base.origin}, ${remote.status}`,
            );
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          outcomes.push({ id, ok: false, error });
          if (!ctx.bool("json")) ctx.logger.error(`Snapshot ${id}: ${error}`);
        } finally {
          rmSync(path, { force: true });
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    if (ctx.bool("json")) printJson(outcomes);
    return outcomes.every((o) => o.ok) ? 0 : 1;
  },
};
