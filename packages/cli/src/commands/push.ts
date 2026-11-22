import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleError, createStorageBackend, exportSnapshotBundle } from "@webfrost/core";
import { type Command, type Context, parseHttpUrl, parseId } from "../cli";
import { CliError, UsageError } from "../errors";
import { printJson, withDb } from "./shared";

/** Bundles smaller than this upload without a progress line. */
const PROGRESS_MIN_BYTES = 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function exportBundle(ctx: Context, id: number, path: string): Promise<number> {
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

async function upload(
  ctx: Context,
  endpoint: string,
  apiKey: string,
  id: number,
  path: string,
  bytes: number,
): Promise<{ id: number; url: string; status: string }> {
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
    throw new Error(
      `cannot reach ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (showProgress) process.stderr.write("\n");
  }

  const text = await res.text();
  let body: { id?: number; url?: string; status?: string; error?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a proxy's error page): reported by status below.
  }
  if (res.status === 201 && typeof body.id === "number") {
    return { id: body.id, url: String(body.url), status: String(body.status) };
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `the server answered with a redirect (HTTP ${res.status}); pass its final URL to --to`,
    );
  }
  if (res.status === 401) throw new Error("the server rejected WEBFROST_API_KEY (HTTP 401)");
  if (res.status === 413) {
    throw new Error(
      `the bundle is larger than the server accepts (HTTP 413; see WEBFROST_IMPORT_BUNDLE_MAX_BYTES, or a proxy's upload limit)`,
    );
  }
  throw new Error(
    `the server refused it: ${body.error ?? (text.slice(0, 200) || "no details")} (HTTP ${res.status})`,
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
  ],
  async run(ctx) {
    const to = ctx.string("to");
    if (!to) throw new UsageError("Missing --to <url>: the server to push to.", ["push"]);
    const base = parseHttpUrl(to, ["push"]);
    const ids = ctx.args.map((raw) => parseId(raw, "snapshot id", ["push"]));
    const apiKey = process.env.WEBFROST_API_KEY;
    if (!apiKey) {
      throw new CliError(
        "WEBFROST_API_KEY is not set. Create an API key on the server (Settings > API keys) and export it: WEBFROST_API_KEY=wf_... webfrost push ...",
      );
    }
    const local =
      base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]";
    if (base.protocol === "http:" && !local) {
      ctx.logger.warn(
        `${base.origin} is plain HTTP: the API key and the snapshot travel unencrypted.`,
      );
    }
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
