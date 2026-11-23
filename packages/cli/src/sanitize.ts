/**
 * Text that comes from archived pages, imports or the database must not reach a terminal raw:
 * an ESC sequence can rewrite the clipboard (OSC 52), the window title or earlier output.
 */

/** C0 and C1 controls, DEL and the Unicode line separators. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// The same, but a message may keep its own line breaks and tabs.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS_KEEP_LAYOUT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Strip control characters (ESC included) from one untrusted value; printable Unicode stays. */
export function safeText(value: unknown): string {
  return String(value ?? "").replace(CONTROLS, "");
}

/** For a whole log message: removes controls but keeps \n, \r\n and \t. */
export function safeMessage(msg: string): string {
  return msg.replace(/\r(?!\n)/g, "").replace(CONTROLS_KEEP_LAYOUT, "");
}
