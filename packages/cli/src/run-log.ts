/**
 * The log of one run of a long command, kept in `logs/` of the data directory: one JSON object
 * per line, written by pino (the server's logger too) straight to the file, synchronously. A line
 * is on disk when the call returns, so what a run did survives a closed terminal, Ctrl+C or a
 * crash, and can be read back with `jq`, `pino-pretty` or anything that reads lines.
 *
 * Every line has `time` (ISO 8601 UTC), `event` and `msg`. A log never holds credentials: no API
 * key, no request headers. It does hold the addresses the run worked on, like the archive itself.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

export interface RunLog {
  /** The file, to tell the person where to look. */
  readonly path: string;
  /** Append one entry. Never throws: a log that cannot be written must not stop the run. */
  write(event: string, message: string, fields?: Record<string, unknown>): void;
  /** Why the log is not being written (a full disk, a read-only folder), if it is not. */
  readonly problem: string | undefined;
}

/** `rescue-2026-11-24T05-40-12Z.jsonl`: sorts by time, and is a legal file name everywhere. */
function fileName(command: string, at: Date, n: number): string {
  const stamp = `${at.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
  return `${command}-${stamp}${n > 1 ? `-${n}` : ""}.jsonl`;
}

/** Start the log of a run of `command` under `<dataDir>/logs/`. */
export function openRunLog(dataDir: string, command: string, now: Date = new Date()): RunLog {
  const dir = join(dataDir, "logs");
  let path = join(dir, fileName(command, now, 1));
  // Two runs started in the same second each get a file of their own.
  for (let n = 2; existsSync(path); n++) path = join(dir, fileName(command, now, n));

  let problem: string | undefined;
  let logger: pino.Logger | undefined;
  try {
    // sync: every line is written before the call returns (no buffer to lose when the process is
    // killed); mkdir: logs/ is created on first use.
    const destination = pino.destination({ dest: path, sync: true, mkdir: true });
    destination.on("error", (err: Error) => {
      problem ??= err.message;
    });
    // No pid or hostname on each line: the file is one run on one machine.
    logger = pino({ base: null, timestamp: pino.stdTimeFunctions.isoTime }, destination);
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  return {
    path,
    get problem() {
      return problem;
    },
    write(event, message, fields = {}) {
      if (problem !== undefined || !logger) return;
      try {
        logger.info({ event, ...fields }, message);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
    },
  };
}
