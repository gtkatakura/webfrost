/**
 * Whether a page that answered 2xx is an anti-bot wall or a login wall instead of the page itself. Anti-bot
 * services (Cloudflare, Akamai, Imperva, PerimeterX, DDoS-Guard and the like) answer with an interstitial
 * of their own that says so in its title or its first lines; a login wall leaves almost no text. Both look
 * like a success to the pipeline, so anything that replaces a failure with a copy archived elsewhere
 * (`webfrost rescue`) checks this first. Generic by design: what the walls say, never a list of sites.
 */

/** Titles (lower case, matched anywhere in the title) that only an interstitial has. */
const WALL_TITLES = [
  "just a moment",
  "attention required",
  "client challenge",
  "access denied",
  "verify you are human",
  "verifying you are human",
  "are you a robot",
  "are you a human",
  "human verification",
  "bot verification",
  "security check",
  "checking your browser",
  "one more step",
  "pardon our interruption",
  "request unsuccessful",
  "you have been blocked",
  "ddos-guard",
  "captcha",
  "forbidden",
];

/** Phrases (lower case) an interstitial's text opens with. */
const WALL_PHRASES = [
  "enable javascript and cookies to continue",
  "checking if the site connection is secure",
  "verify you are human",
  "needs to review the security of your connection",
  "please complete the security check",
  "access to this page has been denied",
];

/** Below this many characters of readable text a page is taken for a wall (login, consent, empty shell). */
export const DEFAULT_MIN_PAGE_TEXT = 150;

/** Why the page looks like a wall rather than the page itself, or null when it looks like the page. */
export function blockPageReason(
  title: string | null | undefined,
  text: string | null | undefined,
  minText: number = DEFAULT_MIN_PAGE_TEXT,
): string | null {
  const t = (title ?? "").trim().toLowerCase();
  const wallTitle = WALL_TITLES.find((w) => t.includes(w));
  if (wallTitle) return `the title says "${title?.trim()}", an anti-bot page`;
  const body = (text ?? "").replace(/\s+/g, " ").trim();
  const head = body.slice(0, 600).toLowerCase();
  const phrase = WALL_PHRASES.find((p) => head.includes(p));
  if (phrase) return `the page says "${phrase}", an anti-bot page`;
  if (body.length < minText) {
    return `only ${body.length} characters of text (a login wall or an empty page?)`;
  }
  return null;
}
