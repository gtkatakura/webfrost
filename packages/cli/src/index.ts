// @webfrost/cli entry point
import { readFileSync } from "node:fs";
import {
  addSchedule,
  addUrl,
  createSnapshot,
  detectFormat,
  getDueSchedules,
  listSchedules,
  listSnapshots,
  markScheduleRun,
  openDb,
  parseUrls,
  removeSchedule,
  runPipeline,
} from "@webfrost/core";

const archiveDir = process.env.WEBFROST_DIR ?? process.cwd();
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "init": {
    openDb(archiveDir).close();
    console.log(`Archive initialized at ${archiveDir}`);
    break;
  }

  case "add": {
    const url = args[0];
    if (!url) {
      console.error("Usage: webfrost add <url>");
      process.exit(1);
    }
    let parsedAdd: URL;
    try {
      parsedAdd = new URL(url);
    } catch {
      console.error("Invalid URL");
      process.exit(1);
    }
    if (parsedAdd.protocol !== "http:" && parsedAdd.protocol !== "https:") {
      console.error("Only http/https URLs are supported");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    await addUrl(db, url, archiveDir);
    db.close();
    break;
  }

  case "list": {
    const db = openDb(archiveDir);
    const snapshots = listSnapshots(db);
    db.close();
    for (const s of snapshots) {
      console.log(`${s.id}\t${s.status}\t${s.url}`);
    }
    break;
  }

  case "schedule": {
    const sub = args[0];

    if (sub === "add") {
      // webfrost schedule add <url> --cron <expr>
      const urlArg = args[1];
      const cronIdx = args.indexOf("--cron");
      const cronExpr = cronIdx !== -1 ? args[cronIdx + 1] : undefined;

      if (!urlArg || !cronExpr) {
        console.error("Usage: webfrost schedule add <url> --cron <expr>");
        process.exit(1);
      }

      let parsedSchedule: URL;
      try {
        parsedSchedule = new URL(urlArg);
      } catch {
        console.error("Invalid URL");
        process.exit(1);
      }
      if (parsedSchedule.protocol !== "http:" && parsedSchedule.protocol !== "https:") {
        console.error("Only http/https URLs are supported");
        process.exit(1);
      }

      const db = openDb(archiveDir);
      try {
        const id = addSchedule(db, urlArg, cronExpr);
        console.log(`Schedule ${id} created: ${urlArg} @ ${cronExpr}`);
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "list") {
      const db = openDb(archiveDir);
      try {
        const schedules = listSchedules(db);
        if (schedules.length === 0) {
          console.log("No schedules.");
        }
        for (const s of schedules) {
          const last = s.last_run_at ?? "never";
          console.log(`${s.id}\t${s.cron}\t${s.url}\tlast:${last}\tnext:${s.next_run_at}`);
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "remove") {
      const idArg = args[1];
      if (!idArg) {
        console.error("Usage: webfrost schedule remove <id>");
        process.exit(1);
      }
      const id = Number(idArg);
      if (!Number.isInteger(id) || id <= 0) {
        console.error("Invalid schedule id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const removed = removeSchedule(db, id);
        if (removed) {
          console.log(`Schedule ${id} removed.`);
        } else {
          console.error(`Schedule ${id} not found.`);
          process.exit(1);
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "worker") {
      // Polling worker: checks due schedules every 30 seconds
      const intervalMs = 30_000;
      console.log(
        `Schedule worker started (polling every ${intervalMs / 1000}s). Press Ctrl+C to stop.`,
      );

      async function runDue(): Promise<void> {
        const db = openDb(archiveDir);
        let due: ReturnType<typeof getDueSchedules>;
        try {
          due = getDueSchedules(db);
        } finally {
          db.close();
        }

        for (const schedule of due) {
          console.log(`[worker] Running schedule ${schedule.id}: ${schedule.url}`);
          const db2 = openDb(archiveDir);
          try {
            const snapshotId = createSnapshot(db2, schedule.url);
            await runPipeline(db2, snapshotId, schedule.url, archiveDir);
            markScheduleRun(db2, schedule.id, schedule.cron);
            console.log(`[worker] Schedule ${schedule.id} done (snapshot ${snapshotId})`);
          } catch (err) {
            console.error(`[worker] Schedule ${schedule.id} failed:`, err);
          } finally {
            db2.close();
          }
        }
      }

      await runDue();
      setInterval(runDue, intervalMs);
      break;
    }

    console.error("Usage: webfrost schedule <add|list|remove|worker>");
    process.exit(1);
    break;
  }

  case "import": {
    const filePath = args[0];
    if (!filePath) {
      console.error("Usage: webfrost import <file>");
      process.exit(1);
    }

    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      console.error(`Cannot read file: ${filePath}`);
      process.exit(1);
    }

    const filename = filePath.split("/").pop() ?? filePath;
    const format = detectFormat(filename, content);
    const urls = parseUrls(content, format);

    const total = urls.length;
    let queued = 0;
    let failed = 0;

    console.log(`Detected format: ${format}. Found ${total} URL(s).`);

    const db = openDb(archiveDir);
    for (const url of urls) {
      try {
        const snapshotId = createSnapshot(db, url);
        // Fire-and-forget pipeline (don't await to keep progress flowing)
        runPipeline(db, snapshotId, url, archiveDir).catch((err: unknown) => {
          console.error(`[import] pipeline error for ${url}:`, err);
        });
        queued++;
        process.stdout.write(
          `\rProgress: ${queued + failed}/${total} (queued: ${queued}, failed: ${failed})`,
        );
      } catch {
        failed++;
        process.stdout.write(
          `\rProgress: ${queued + failed}/${total} (queued: ${queued}, failed: ${failed})`,
        );
      }
    }
    db.close();

    console.log(`\nImport complete: total=${total}, queued=${queued}, failed=${failed}`);
    break;
  }

  default: {
    console.error(`Unknown command: ${String(command)}`);
    process.exit(1);
  }
}
