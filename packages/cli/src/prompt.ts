import { CliError } from "./errors";

/** Read all of stdin as text (for `--password-stdin`). */
export async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

/** The first line of a piped secret, without the line ending. */
export function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? "";
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/**
 * Ask for a secret on the terminal without echoing it. The prompt goes to stderr so
 * stdout stays clean. Ctrl+C cancels (exit code 130).
 */
export async function promptSecret(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (fn: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish(() => resolve(value));
          return;
        }
        if (ch === "\u0003") {
          finish(() => reject(new CliError("Cancelled.", 130)));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
        } else if (ch >= " ") {
          value += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}
