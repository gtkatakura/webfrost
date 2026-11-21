/** Exit codes: 0 success, 1 the command failed, 2 the command line was wrong. */
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/** The command ran and failed. Printed as `Error: <message>`; exit code 1 unless given. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT_FAILURE,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** The command line is wrong (unknown command or flag, missing argument): exit code 2. */
export class UsageError extends CliError {
  constructor(
    message: string,
    /** Command path the usage hint points at, e.g. ["schedule", "add"]. */
    readonly commandPath: string[] = [],
  ) {
    super(message, EXIT_USAGE);
    this.name = "UsageError";
  }
}
