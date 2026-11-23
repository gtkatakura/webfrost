import { mkdirSync } from "node:fs";
import {
  CronError,
  JobRunner,
  SCHEDULER_INTERVAL_MS,
  addRssFeedSchedule,
  addSchedule,
  listSchedules,
  removeSchedule,
  startScheduler,
} from "@webfrost/core";
import { type Command, type Group, parseHttpUrl, parseId } from "../cli";
import { CliError, UsageError } from "../errors";
import { safeText } from "../sanitize";
import { withDb } from "./shared";

const scheduleAdd: Command = {
  kind: "command",
  name: "add",
  summary: "Archive a URL, or every new entry of an RSS feed, on a cron schedule",
  args: [{ name: "url", description: "URL to archive (omit when using --rss)", required: false }],
  options: {
    cron: {
      type: "string",
      value: "expr",
      description: 'Five-field cron expression, for example "0 * * * *" (hourly)',
    },
    rss: { type: "string", value: "feed-url", description: "Archive the entries of this feed" },
  },
  examples: [
    'webfrost schedule add https://example.com --cron "0 * * * *"',
    'webfrost schedule add --rss https://example.com/feed.xml --cron "*/30 * * * *"',
  ],
  async run(ctx) {
    const path = ["schedule", "add"];
    const rss = ctx.string("rss");
    const cron = ctx.string("cron");
    const positional = ctx.args[0];
    if (rss !== undefined && positional !== undefined) {
      throw new UsageError("Give either a URL or --rss <feed-url>, not both.", path);
    }
    const target = rss ?? positional;
    if (!target) throw new UsageError("Missing URL: pass <url> or --rss <feed-url>.", path);
    if (!cron) throw new UsageError("Missing --cron <expr>.", path);
    parseHttpUrl(target, path);
    await withDb(ctx, async (db) => {
      let id: number;
      try {
        id =
          rss !== undefined
            ? await addRssFeedSchedule(db, target, cron)
            : await addSchedule(db, target, cron);
      } catch (err) {
        // Only a bad cron expression is a usage error; a database failure is not.
        if (err instanceof CronError) {
          throw new UsageError(`Invalid cron expression "${cron}": ${err.message}`, path);
        }
        throw err;
      }
      const label = rss !== undefined ? "RSS feed schedule" : "Schedule";
      ctx.logger.info(`${label} ${id} created: ${target} @ ${cron}`);
    });
    return 0;
  },
};

const scheduleList: Command = {
  kind: "command",
  name: "list",
  summary: "List schedules",
  async run(ctx) {
    await withDb(ctx, async (db) => {
      const schedules = await listSchedules(db);
      if (schedules.length === 0) console.log("No schedules.");
      for (const s of schedules) {
        const kind = s.kind === "rss_feed" ? "[rss]" : "[url]";
        console.log(
          `${s.id}\t${kind}\t${s.cron}\t${safeText(s.url)}\tlast:${s.last_run_at ?? "never"}\tnext:${s.next_run_at}`,
        );
      }
    });
    return 0;
  },
};

const scheduleRemove: Command = {
  kind: "command",
  name: "remove",
  summary: "Remove a schedule",
  args: [{ name: "id", description: "Schedule id (see `webfrost schedule list`)" }],
  async run(ctx) {
    const id = parseId(ctx.args[0] ?? "", "schedule id", ["schedule", "remove"]);
    await withDb(ctx, async (db) => {
      if (!(await removeSchedule(db, id))) throw new CliError(`Schedule ${id} not found.`);
      ctx.logger.info(`Schedule ${id} removed.`);
    });
    return 0;
  },
};

const scheduleWorker: Command = {
  kind: "command",
  name: "worker",
  summary: "Run due schedules until stopped (Ctrl+C)",
  description:
    "Poll for due schedules and archive them. The same scheduler `webfrost serve` embeds; run this instead when the server runs with WEBFROST_SCHEDULER=false. Running both on one archive is safe: a due schedule is claimed atomically.",
  async run(ctx) {
    // Due schedules are claimed atomically, so running this next to a server on the same
    // archive is safe.
    mkdirSync(ctx.dir, { recursive: true });
    const runner = new JobRunner({ dir: ctx.dir, logger: () => ctx.logger });
    // Adopt snapshots an interrupted run left pending. Only jobs whose heartbeat has gone
    // stale are taken, so work a live server is doing is left alone; the sweep repeats
    // because a freshly crashed process still looks alive for a while.
    // One sweep at a time: a slow database must not stack them up.
    let sweeping = false;
    const recover = async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        const recovered = await runner.recoverPending();
        if (recovered > 0) {
          ctx.logger.info(`Re-queued ${recovered} snapshot(s) left pending by an interrupted run.`);
        }
      } catch (err) {
        ctx.logger.warn(
          `Recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        sweeping = false;
      }
    };
    await recover();
    const recovery = setInterval(() => void recover(), 60_000);
    const scheduler = startScheduler({ dir: ctx.dir, runner, logger: ctx.logger });
    ctx.logger.info(
      `Schedule worker started (polling every ${SCHEDULER_INTERVAL_MS / 1000}s, concurrency ${runner.concurrency}). Press Ctrl+C to stop.`,
    );

    return await new Promise<number>((resolve) => {
      ctx.onSignal((signal) => {
        ctx.logger.info(`${signal} received: stopping, waiting for running archives...`);
        clearInterval(recovery);
        scheduler.stop();
        // Jobs still running when the deadline passes stay pending and are adopted on the
        // next start, so waiting is a courtesy, not a requirement.
        const deadline = new Promise<void>((r) => setTimeout(r, 20_000));
        void Promise.race([runner.onIdle(), deadline]).then(() => resolve(0));
      });
    });
  },
};

export const scheduleGroup: Group = {
  kind: "group",
  name: "schedule",
  summary: "Archive URLs and RSS feeds on a cron schedule",
  children: [scheduleAdd, scheduleList, scheduleRemove, scheduleWorker],
};
