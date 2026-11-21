import { parseArgs } from "node:util";
import { UsageError } from "./errors";
import type { Logger } from "./logger";

/** One flag of a command. `short` is a single letter; `value` is the placeholder shown in help. */
export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  description: string;
  value?: string;
}

export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  /** Takes every remaining argument. */
  variadic?: boolean;
}

export interface Command {
  kind: "command";
  name: string;
  summary: string;
  /** Longer text shown by `webfrost <command> --help`. */
  description?: string;
  args?: ArgSpec[];
  options?: Record<string, OptionSpec>;
  examples?: string[];
  /** Extra sections of the help text (environment variables, exit codes...). */
  notes?: string;
  run: (ctx: Context) => Promise<number | undefined>;
}

/** A command that only dispatches to subcommands (`webfrost tag add`). */
export interface Group {
  kind: "group";
  name: string;
  summary: string;
  children: CommandNode[];
}

export type CommandNode = Command | Group;

/** What a running command gets. */
export interface Context {
  /** Positional arguments, after the command path. */
  args: string[];
  logger: Logger;
  /** The archive directory (WEBFROST_DIR, or ~/.webfrost). */
  dir: string;
  verbose: boolean;
  quiet: boolean;
  string(name: string): string | undefined;
  bool(name: string): boolean;
  /** An integer flag; a value that is not an integer >= `min` is a usage error. */
  int(name: string, opts?: { min?: number; max?: number }): number | undefined;
  /**
   * Replace what happens on the first SIGINT/SIGTERM. The default is to exit with
   * 128+signal. The handler runs once; a second signal always exits at once.
   */
  onSignal(handler: (signal: NodeJS.Signals) => void): void;
}

export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  help: { type: "boolean", short: "h", description: "Show help for this command" },
  verbose: { type: "boolean", description: "Debug-level output; errors include stack traces" },
  quiet: { type: "boolean", description: "Only warnings and errors" },
};

type ParsedValues = Record<string, string | boolean | undefined>;

export interface ParsedCommand {
  values: ParsedValues;
  positionals: string[];
}

/** Parse the arguments after the command path against the command's schema. */
export function parseCommandArgs(command: Command, path: string[], argv: string[]): ParsedCommand {
  const options = { ...GLOBAL_OPTIONS, ...command.options };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: Object.fromEntries(
        Object.entries(options).map(([name, o]) => [
          name,
          { type: o.type, ...(o.short ? { short: o.short } : {}) },
        ]),
      ),
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? cleanParseError(err.message) : String(err), path);
  }
  const values = parsed.values as ParsedValues;
  const positionals = parsed.positionals;

  if (!values.help) {
    const specs = command.args ?? [];
    const required = specs.filter((a) => a.required !== false);
    const variadic = specs.some((a) => a.variadic);
    if (positionals.length < required.length) {
      const missing = required[positionals.length];
      throw new UsageError(`Missing argument <${missing?.name}>.`, path);
    }
    if (!variadic && positionals.length > specs.length) {
      throw new UsageError(`Unexpected argument "${positionals[specs.length]}".`, path);
    }
  }
  return { values, positionals };
}

/** node:util's messages end with advice about passing `--` that does not help here. */
function cleanParseError(message: string): string {
  return message
    .replace(/\. To specify a positional argument starting with a '-'.*$/s, ".")
    .replace(/\.\.$/, ".");
}

export function createContext(opts: {
  parsed: ParsedCommand;
  logger: Logger;
  dir: string;
  path: string[];
  setSignalHandler: (handler: (signal: NodeJS.Signals) => void) => void;
}): Context {
  const { parsed } = opts;
  return {
    args: parsed.positionals,
    logger: opts.logger,
    dir: opts.dir,
    verbose: parsed.values.verbose === true,
    quiet: parsed.values.quiet === true,
    string(name) {
      const v = parsed.values[name];
      return typeof v === "string" ? v : undefined;
    },
    bool(name) {
      return parsed.values[name] === true;
    },
    int(name, limits = {}) {
      const raw = parsed.values[name];
      if (typeof raw !== "string") return undefined;
      const n = Number(raw);
      if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(n)) {
        throw new UsageError(`--${name} must be an integer, got "${raw}".`, opts.path);
      }
      if (limits.min !== undefined && n < limits.min) {
        throw new UsageError(`--${name} must be at least ${limits.min}.`, opts.path);
      }
      if (limits.max !== undefined && n > limits.max) {
        throw new UsageError(`--${name} must be at most ${limits.max}.`, opts.path);
      }
      return n;
    },
    onSignal: opts.setSignalHandler,
  };
}

/** A positive integer id from the command line. */
export function parseId(raw: string, what: string, path: string[]): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n <= 0) {
    throw new UsageError(`Invalid ${what}: "${raw}" (expected a positive integer).`, path);
  }
  return n;
}

/** An http(s) URL, or a usage error. */
export function parseHttpUrl(raw: string, path: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`Invalid URL: ${raw}`, path);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`Only http and https URLs are supported (got ${url.protocol}).`, path);
  }
  return url;
}

// ── Help ───────────────────────────────────────────────────────────────────────

export function usageLine(command: Command, path: string[]): string {
  const args = (command.args ?? [])
    .map((a) => {
      const name = a.variadic ? `${a.name}...` : a.name;
      return a.required === false ? `[${name}]` : `<${name}>`;
    })
    .join(" ");
  return ["webfrost", ...path, args, "[options]"].filter(Boolean).join(" ");
}

function table(rows: [string, string][], indent = "  "): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}  ${right}`).join("\n");
}

function optionRows(options: Record<string, OptionSpec>): [string, string][] {
  return Object.entries(options).map(([name, o]) => {
    const short = o.short ? `-${o.short}, ` : "    ";
    const value = o.type === "string" ? ` <${o.value ?? "value"}>` : "";
    return [`${short}--${name}${value}`, o.description];
  });
}

export function commandHelp(command: Command, path: string[]): string {
  const sections: string[] = [`Usage: ${usageLine(command, path)}`];
  sections.push(command.description ?? command.summary);
  if (command.args?.length) {
    sections.push(`Arguments:\n${table(command.args.map((a) => [a.name, a.description]))}`);
  }
  const own = command.options ? optionRows(command.options) : [];
  const global = optionRows(GLOBAL_OPTIONS);
  sections.push(`Options:\n${table([...own, ...global])}`);
  if (command.notes) sections.push(command.notes.trim());
  if (command.examples?.length) {
    sections.push(`Examples:\n${command.examples.map((e) => `  ${e}`).join("\n")}`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function groupHelp(group: Group, path: string[]): string {
  const rows = group.children.map((c): [string, string] => [c.name, c.summary]);
  return `${[
    `Usage: webfrost ${path.join(" ")} <command> [options]`,
    group.summary,
    `Commands:\n${table(rows)}`,
    `Run "webfrost ${path.join(" ")} <command> --help" for the options of one command.`,
  ].join("\n\n")}\n`;
}

export function rootHelp(version: string, nodes: CommandNode[]): string {
  const rows = nodes.map((n): [string, string] => [n.name, n.summary]);
  return `webfrost v${version}: self-hosted web archiving toolkit

Usage: webfrost <command> [options]

Commands:
${table(rows)}

Global options:
${table([...optionRows(GLOBAL_OPTIONS), ["-v, --version", "Print the version and exit"]])}

Run "webfrost help <command>" or "webfrost <command> --help" for the options of one command.

Environment:
  WEBFROST_DIR              Data directory (default: ~/.webfrost)
  WEBFROST_CHROMIUM_PATH    Chromium or Chrome executable to use
  WEBFROST_LOG_LEVEL        debug | info | warn | error (default: info)
  WEBFROST_CONCURRENCY      Archives run in parallel by import and schedule worker (default: 3)

Exit codes: 0 success, 1 the command failed, 2 usage error.

Quick start:
  webfrost setup                  Install a headless Chromium if you have none
  webfrost serve                  Server, web UI and scheduler on :3000
  webfrost add https://example.com
`;
}

/** Walk the command tree along the arguments: returns the node the path ends on. */
export function resolveCommand(
  nodes: CommandNode[],
  argv: string[],
): { node: CommandNode; path: string[]; rest: string[] } | { unknown: string; path: string[] } {
  let level = nodes;
  const path: string[] = [];
  let rest = argv;
  for (;;) {
    const name = rest[0];
    if (name === undefined || name.startsWith("-")) {
      // A group with no (valid) subcommand shows its own help.
      const parent = path.length ? findNode(nodes, path) : undefined;
      if (parent) return { node: parent, path, rest };
      return { unknown: name ?? "", path };
    }
    const node = level.find((n) => n.name === name);
    if (!node) return { unknown: name, path };
    path.push(name);
    rest = rest.slice(1);
    if (node.kind === "command") return { node, path, rest };
    level = node.children;
    if (rest[0] === undefined || rest[0].startsWith("-")) return { node, path, rest };
  }
}

export function findNode(nodes: CommandNode[], path: string[]): CommandNode | undefined {
  let level = nodes;
  let found: CommandNode | undefined;
  for (const name of path) {
    found = level.find((n) => n.name === name);
    if (!found) return undefined;
    level = found.kind === "group" ? found.children : [];
  }
  return found;
}
