import { mkdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import {
  BundleError,
  type ImportFormat,
  JobRunner,
  ResponseTooLargeError,
  createStorageBackend,
  detectFormat,
  fetchGuarded,
  getSnapshot,
  importMaxBytes,
  importMaxUrls,
  importSnapshotBundle,
  importTooLargeMessage,
  importTooManyUrlsMessage,
  isUrlArchived,
  parseUrls,
} from "@webfrost/core";
import type { Command } from "../cli";
import { CliError, UsageError } from "../errors";
import { withDb } from "./shared";

const FORMATS: readonly ImportFormat[] = ["rss", "opml", "netscape", "text"];

/** True when the file starts like a ZIP archive (a snapshot bundle). */
async function isZipFile(path: string): Promise<boolean> {
  try {
    const head = await Bun.file(path).slice(0, 4).bytes();
    return (
      head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4
    );
  } catch {
    return false;
  }
}

function isHttpUrl(source: string): boolean {
  try {
    const { protocol } = new URL(source);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const importCommand: Command = {
  kind: "command",
  name: "import",
  summary: "Bulk-archive the URLs of a bookmarks file, OPML, RSS feed or text list",
  description:
    "Read URLs from a file or an http(s) address and archive each one. The format is detected from the content unless --format is given. A snapshot bundle (a ZIP from `webfrost export`) is stored as a new snapshot instead, without archiving anything again.",
  args: [{ name: "source", description: "A file path or an http(s) URL" }],
  options: {
    format: {
      type: "string",
      value: "fmt",
      description: `Force the format: ${FORMATS.join(", ")}`,
    },
  },
  notes: `
Exit codes:
  0  every URL was archived (or skipped as already archived, for RSS)
  1  at least one URL could not be queued or ended with a failed snapshot
  2  usage error`,
  examples: [
    "webfrost import bookmarks.html",
    "webfrost import --format=rss https://example.com/feed.xml",
    "webfrost import snapshot-12.zip",
  ],
  async run(ctx) {
    const source = ctx.args[0] ?? "";
    const formatFlag = ctx.string("format");
    if (formatFlag !== undefined && !FORMATS.includes(formatFlag as ImportFormat)) {
      throw new UsageError(`Unknown --format "${formatFlag}". Use one of: ${FORMATS.join(", ")}.`, [
        "import",
      ]);
    }

    // Same SSRF-safe fetcher as everywhere else (size cap, timeout, private ranges refused
    // unless WEBFROST_ALLOW_PRIVATE_URLS=true).
    const isSourceUrl = isHttpUrl(source);

    // A snapshot bundle (`webfrost export`): stored as it is, nothing is archived again.
    if (!isSourceUrl && formatFlag === undefined && (await isZipFile(source))) {
      try {
        const imported = await withDb(ctx, (db) =>
          importSnapshotBundle(db, createStorageBackend(ctx.dir), source),
        );
        ctx.logger.info(
          `Imported snapshot bundle ${basename(source)} as snapshot ${imported.id} (${imported.status}): ${imported.url}`,
        );
        return 0;
      } catch (err) {
        if (err instanceof BundleError) throw new CliError(err.message);
        throw err;
      }
    }
    let content: string;
    let filename: string;
    let finalUrl: string | undefined;
    if (isSourceUrl) {
      let response: Awaited<ReturnType<typeof fetchGuarded>>;
      try {
        response = await fetchGuarded(source, { maxBytes: importMaxBytes() });
      } catch (err) {
        if (err instanceof ResponseTooLargeError) throw new CliError(importTooLargeMessage());
        throw new CliError(
          `Cannot fetch ${source}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CliError(`Cannot fetch ${source}: HTTP ${response.status}`);
      }
      if (response.body.byteLength > importMaxBytes()) throw new CliError(importTooLargeMessage());
      content = new TextDecoder().decode(response.body);
      finalUrl = response.url;
      filename = basename(new URL(source).pathname) || source;
    } else {
      try {
        if (statSync(source).size > importMaxBytes()) throw new CliError(importTooLargeMessage());
        content = readFileSync(source, "utf8");
      } catch (err) {
        if (err instanceof CliError) throw err;
        throw new CliError(`Cannot read file: ${source}`);
      }
      filename = basename(source);
    }

    const format = (formatFlag as ImportFormat | undefined) ?? detectFormat(filename, content);
    // A feed fetched from a URL may use links relative to the URL it was finally served from.
    const urls = parseUrls(content, format, finalUrl, { maxUrls: importMaxUrls() });
    if (urls.length > importMaxUrls()) throw new CliError(importTooManyUrlsMessage(urls.length));
    // For RSS imports, skip what is already archived.
    const deduplicate = format === "rss";

    const total = urls.length;
    let queued = 0;
    let skipped = 0;
    let failed = 0;

    mkdirSync(ctx.dir, { recursive: true });
    const runner = new JobRunner({ dir: ctx.dir, logger: () => ctx.logger });
    ctx.logger.info(
      `Detected format: ${format}. Found ${total} URL(s). Concurrency: ${runner.concurrency}.`,
    );

    // A signal leaves the queued snapshots pending; `webfrost serve` or
    // `webfrost schedule worker` adopts them later.
    ctx.onSignal((signal) => {
      ctx.logger.warn(
        `${signal} received: stopping. Unfinished snapshots stay pending and resume the next time a server or schedule worker starts.`,
      );
      process.exit(signal === "SIGINT" ? 130 : 143);
    });

    const importStart = Date.now();
    const snapshotIds: number[] = [];
    await withDb(ctx, async (db) => {
      for (const url of urls) {
        if (deduplicate && (await isUrlArchived(db, url))) {
          skipped++;
          continue;
        }
        try {
          const snapshotId = await runner.add(db, url);
          snapshotIds.push(snapshotId);
          queued++;
          ctx.logger.debug(
            `Enqueued ${queued + failed + skipped}/${total}: ${url} (snapshot ${snapshotId})`,
          );
        } catch {
          failed++;
          ctx.logger.warn(`Failed to enqueue ${queued + failed + skipped}/${total}: ${url}`);
        }
      }

      if (queued > 0) {
        ctx.logger.info(`Running ${queued} pipeline(s)...`);
        await runner.onIdle();
      }

      // Report what actually happened, not just what was queued.
      let done = 0;
      for (const id of snapshotIds) {
        if ((await getSnapshot(db, id))?.status === "done") done++;
        else failed++;
      }

      const elapsed = ((Date.now() - importStart) / 1000).toFixed(1);
      ctx.logger.info(
        `Import complete: total=${total}, done=${done}, skipped=${skipped}, failed=${failed} (${elapsed}s)`,
      );
    });
    return failed > 0 ? 1 : 0;
  },
};
