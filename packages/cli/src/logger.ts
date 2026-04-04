export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(level: LogLevel = "info"): Logger {
  const minLevel = LEVELS[level];

  function write(lvl: LogLevel, msg: string): void {
    if (LEVELS[lvl] < minLevel) return;
    const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
    const label = lvl.toUpperCase().padEnd(5);
    const line = `[${ts}] ${label} ${msg}\n`;
    if (lvl === "error" || lvl === "warn") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  return {
    debug: (msg) => write("debug", msg),
    info: (msg) => write("info", msg),
    warn: (msg) => write("warn", msg),
    error: (msg) => write("error", msg),
  };
}

export function resolveLogLevel(flags: { verbose: boolean; quiet: boolean }): LogLevel {
  if (flags.verbose) return "debug";
  if (flags.quiet) return "warn";
  const env = process.env.WEBFROST_LOG_LEVEL;
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return "info";
}
