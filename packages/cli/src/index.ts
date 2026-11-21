// @webfrost/cli entry point: the `webfrost` command.
import { webfrostDataDir } from "@webfrost/core";
import {
  type Command,
  type CommandNode,
  type Group,
  commandHelp,
  createContext,
  findNode,
  groupHelp,
  parseCommandArgs,
  resolveCommand,
  rootHelp,
  usageLine,
} from "./cli";
import { commands } from "./commands";
import { CliError, EXIT_USAGE, UsageError } from "./errors";
import { createLogger, resolveLogLevel } from "./logger";
import { VERSION } from "./version";

const SIGNAL_NUMBERS: Record<string, number> = { SIGINT: 2, SIGTERM: 15 };

/** Print text to stdout, or to stderr when the caller is reporting a usage error. */
function print(text: string, stream: "stdout" | "stderr" = "stdout"): void {
  process[stream].write(text);
}

function describeError(err: unknown, verbose: boolean): string {
  if (verbose && err instanceof Error && err.stack) return err.stack;
  return err instanceof Error ? err.message : String(err);
}

function usageHint(error: UsageError): string {
  const path = error.commandPath;
  const node = findNode(commands, path);
  const lines: string[] = [];
  if (node?.kind === "command") lines.push(`Usage: ${usageLine(node, path)}`);
  lines.push(
    path.length > 0
      ? `Run "webfrost ${path.join(" ")} --help" for details.`
      : `Run "webfrost --help" for the list of commands.`,
  );
  return lines.join("\n");
}

function showHelp(
  node: CommandNode | undefined,
  path: string[],
  stream: "stdout" | "stderr",
): void {
  if (!node) print(rootHelp(VERSION, commands), stream);
  else if (node.kind === "group") print(groupHelp(node as Group, path), stream);
  else print(commandHelp(node as Command, path), stream);
}

/**
 * Run the CLI with the given arguments (without the program name). Resolves to the exit
 * code; every failure is turned into one `Error: <message>` line on stderr.
 */
export async function main(argv: string[]): Promise<number> {
  const verbose = argv.includes("--verbose");
  try {
    return await run(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      print(`Error: ${err.message}\n${usageHint(err)}\n`, "stderr");
      return err.exitCode;
    }
    if (err instanceof CliError) {
      print(`Error: ${describeError(err, verbose)}\n`, "stderr");
      return err.exitCode;
    }
    print(`Error: ${describeError(err, verbose)}\n`, "stderr");
    return 1;
  }
}

async function run(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined) {
    // No command is a usage error, but it still shows what the usage is.
    showHelp(undefined, [], "stderr");
    return EXIT_USAGE;
  }
  if (first === "--help" || first === "-h") {
    showHelp(undefined, [], "stdout");
    return 0;
  }
  if (first === "--version" || first === "-v" || first === "version") {
    print(`webfrost v${VERSION}\n`);
    return 0;
  }
  if (first === "help") {
    const resolved = resolveCommand(commands, rest);
    if ("unknown" in resolved && resolved.unknown !== "") {
      throw new UsageError(`Unknown command: ${[...resolved.path, resolved.unknown].join(" ")}`);
    }
    showHelp(
      "node" in resolved ? resolved.node : undefined,
      "node" in resolved ? resolved.path : [],
      "stdout",
    );
    return 0;
  }

  const resolved = resolveCommand(commands, argv);
  if ("unknown" in resolved) {
    throw new UsageError(`Unknown command: ${[...resolved.path, resolved.unknown].join(" ")}`);
  }
  const { node, path, rest: commandArgs } = resolved;

  if (node.kind === "group") {
    const wantsHelp = commandArgs.includes("--help") || commandArgs.includes("-h");
    showHelp(node, path, wantsHelp ? "stdout" : "stderr");
    return wantsHelp ? 0 : EXIT_USAGE;
  }

  const parsed = parseCommandArgs(node, path, commandArgs);
  if (parsed.values.help) {
    showHelp(node, path, "stdout");
    return 0;
  }

  // With --json, stdout carries the result only; progress and log lines go to stderr.
  const logger = createLogger(
    resolveLogLevel({
      verbose: parsed.values.verbose === true,
      quiet: parsed.values.quiet === true,
    }),
    { toStderr: parsed.values.json === true },
  );

  // SIGINT/SIGTERM: a long-running command registers how to wind down; the rest exit at
  // once. A second signal always exits at once.
  let handler: ((signal: NodeJS.Signals) => void) | undefined;
  let signalled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    const code = 128 + (SIGNAL_NUMBERS[signal] ?? 0);
    if (signalled || !handler) process.exit(code);
    signalled = true;
    handler(signal);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const ctx = createContext({
    parsed,
    logger,
    dir: webfrostDataDir(),
    path,
    setSignalHandler: (h) => {
      handler = h;
    },
  });
  try {
    return (await node.run(ctx)) ?? 0;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
