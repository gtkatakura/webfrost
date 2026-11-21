/**
 * Run an external command and collect its output, without ever waiting forever.
 *
 * Waiting for "the process exited AND both pipes reached EOF" looks safe but is not:
 *   - a pipe only reports EOF once every process holding its write end has closed
 *     it, and a grandchild (or a sibling that inherited the descriptor during a
 *     concurrent spawn) can keep it open long after the command itself is gone;
 *   - under heavy concurrent I/O the runtime occasionally fails to deliver one of
 *     the two notifications at all.
 * Either way the caller would hang — here that meant an archive pipeline holding a
 * concurrency slot for half an hour after yt-dlp had already finished.
 *
 * So: as soon as one of the two signals arrives, the other gets a short grace
 * period, and then the result is built from whatever has been collected.
 */

export interface ProcessResult {
  /** Exit code, or null if the process was killed or its exit status could not be determined. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  /** Kill the process after this many ms (0 = no limit). */
  timeoutMs?: number;
  /** How long to wait for the second of {exit, pipes closed} once the first has happened. */
  graceMs?: number;
  /** Kill the process when this aborts; `runProcess` then rejects with the abort reason. */
  signal?: AbortSignal;
  /**
   * Start the command in its own process group and, on timeout, abort or exit, kill
   * the whole group — so helpers it started (yt-dlp runs ffmpeg) do not outlive it.
   * POSIX only; elsewhere only the direct child is killed.
   */
  processGroup?: boolean;
}

const DEFAULT_GRACE_MS = 3000;

/** Accumulates a stream as text so partial output is available even if EOF never comes. */
function collect(stream: ReadableStream<Uint8Array>): { text: () => string; done: Promise<void> } {
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch {
      // A broken pipe just ends the output early.
    }
  })();
  return { text: () => text, done };
}

/**
 * On Linux an exited-but-unreaped child still has its status in /proc/<pid>/stat
 * (field 52, in waitpid format). Used when the runtime never reported the exit.
 */
async function exitCodeFromProc(pid: number): Promise<number | null> {
  try {
    const stat = await Bun.file(`/proc/${pid}/stat`).text();
    // "pid (comm) state …" — comm may contain spaces and parentheses, so split after the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] !== "Z") return null;
    const status = Number(fields[49]);
    if (!Number.isInteger(status)) return null;
    // Low 7 bits set → terminated by a signal, there is no exit code.
    return (status & 0x7f) === 0 ? (status >> 8) & 0xff : null;
  } catch {
    return null;
  }
}

function settledWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Process groups started with `processGroup: true` that may still have members.
 * They are detached from our own group, so a Ctrl+C in the terminal or a SIGTERM to
 * this process no longer reaches them: kill them ourselves on the way out.
 */
const liveGroups = new Set<number>();
const EXIT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let exitHooksInstalled = false;

function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

function killLiveGroups(): void {
  for (const pgid of liveGroups) killGroup(pgid);
  liveGroups.clear();
}

function onExitSignal(signal: NodeJS.Signals): void {
  killLiveGroups();
  uninstallSignalHooks();
  // Nobody else handles this signal: restore its default effect (terminate).
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function installSignalHooks(): void {
  if (!exitHooksInstalled) {
    exitHooksInstalled = true;
    process.on("exit", killLiveGroups);
  }
  for (const sig of EXIT_SIGNALS) {
    if (!process.listeners(sig).includes(onExitSignal)) process.on(sig, onExitSignal);
  }
}

function uninstallSignalHooks(): void {
  for (const sig of EXIT_SIGNALS) process.off(sig, onExitSignal);
}

/**
 * Spawn `command` and resolve with its exit code and output.
 * Throws (with `code: "ENOENT"`) if the executable does not exist.
 */
export async function runProcess(
  command: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const timeoutMs = options.timeoutMs ?? 0;
  const { signal } = options;
  const group = options.processGroup === true && process.platform !== "win32";

  signal?.throwIfAborted();
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // The current environment (Bun otherwise uses a copy taken at startup, so a PATH
    // set later, e.g. by an embedding app, would not be used to find the command).
    env: process.env,
    // setsid(): the child leads a new process group whose id is its pid.
    ...(group ? { detached: true } : {}),
  });
  if (group) {
    liveGroups.add(proc.pid);
    installSignalHooks();
  }

  const kill = () => {
    if (group) killGroup(proc.pid);
    try {
      proc.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };

  const stdout = collect(proc.stdout);
  const stderr = collect(proc.stderr);
  const pipesClosed = Promise.all([stdout.done, stderr.done]).then(() => undefined);

  // Timeout and abort both kill the process (its whole group, if it has one); the
  // exit then arrives through the race below like any other.
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) killTimer = setTimeout(kill, timeoutMs);
  // After an abort, wait at most graceMs for the killed process to be reported.
  let abortGraceTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveAborted: (v: { what: "backstop" }) => void = () => {};
  const aborted = new Promise<{ what: "backstop" }>((resolve) => {
    resolveAborted = resolve;
  });
  const onAbort = () => {
    kill();
    abortGraceTimer = setTimeout(() => resolveAborted({ what: "backstop" }), graceMs);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  // Last resort if neither signal ever arrives: do not outlive the kill timeout by much.
  let backstopTimer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<{ what: "backstop" }>((resolve) => {
    if (timeoutMs > 0) {
      backstopTimer = setTimeout(() => resolve({ what: "backstop" }), timeoutMs + graceMs);
    }
  });

  let exitCode: number | null = null;
  try {
    const first = await Promise.race([
      proc.exited.then((code) => ({ what: "exit" as const, code })),
      pipesClosed.then(() => ({ what: "pipes" as const })),
      backstop,
      aborted,
    ]);

    if (first.what === "exit") {
      exitCode = first.code;
      await settledWithin(pipesClosed, graceMs);
    } else if (first.what === "pipes") {
      const exit = await settledWithin(proc.exited, graceMs);
      exitCode = exit.settled ? exit.value : await exitCodeFromProc(proc.pid);
    }

    if (first.what === "backstop" || (exitCode === null && proc.exitCode === null)) {
      // Still (or possibly still) alive: make sure it does not linger.
      kill();
    }
  } finally {
    // A pending timer would keep a short-lived CLI process alive for the whole timeout.
    clearTimeout(backstopTimer);
    clearTimeout(killTimer);
    clearTimeout(abortGraceTimer);
    signal?.removeEventListener("abort", onAbort);
    if (group) {
      // Whatever the command left running in its group goes with it.
      killGroup(proc.pid);
      liveGroups.delete(proc.pid);
      if (liveGroups.size === 0) uninstallSignalHooks();
    }
  }

  signal?.throwIfAborted();
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}
