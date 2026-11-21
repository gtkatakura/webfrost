/** Location state carried from a redirect to /login so a successful sign-in can return there. */
export interface LoginLocationState {
  from?: string;
}

/** Path to return to after login; only same-app absolute paths other than /login are honoured. */
export function returnToPath(state: unknown): string {
  const from = (state as LoginLocationState | null | undefined)?.from;
  if (typeof from !== "string") return "/";
  if (!from.startsWith("/") || from.startsWith("//")) return "/";
  if (from === "/login" || from.startsWith("/login?")) return "/";
  return from;
}
