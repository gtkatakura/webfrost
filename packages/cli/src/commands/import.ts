import { mkdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  type ImportFormat,
  JobRunner,
  detectFormat,
  getSnapshot,
  isUrlArchived,
  parseUrls,
  safeFetch,
} from "@webfrost/core";
import type { Command } from "../cli";
import { CliError, UsageError } from "../errors";
import { withDb } from "./shared";

const FORMATS: readonly ImportFormat[] = ["rss", "opml", "netscape", "text"];

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
    "Read URLs from a file or an http(s) address and archive each one. The format is detected from the content unless --format is given.",
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
    let content: string;
    let filename: string;
    if (isSourceUrl) {
      let response: Response;
      try {
        response = await safeFetch(source);
      } catch (err) {
        throw new CliError(
          `Cannot fetch ${source}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!response.ok) throw new CliError(`Cannot fetch ${source}: HTTP ${response.status}`);
      content = await response.text();
      filename = basename(new URL(source).pathname) || source;
    } else {
      try {
        content = readFileSync(source, "utf8");
      } catch {
        throw new CliError(`Cannot read file: ${source}`);
      }
      filename = basename(source);
    }

    const format = (formatFlag as ImportFormat | undefined) ?? detectFormat(filename, content);
    // A feed fetched from a URL may use links relative to it.
    const urls = parseUrls(content, format, isSourceUrl ? source : undefined);
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
