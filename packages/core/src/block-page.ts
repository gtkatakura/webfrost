/**
 * Whether a page that answered 2xx is an anti-bot wall or a login wall instead of the page itself. Anti-bot
 * services (Cloudflare, Akamai, Imperva, PerimeterX, DDoS-Guard and the like) answer with an interstitial
 * of their own that says so in its title or its first lines; a login wall leaves almost no text. Both look
 * like a success to the pipeline, so anything that replaces a failure with a copy archived elsewhere
 * (`webfrost rescue`) checks this first. Generic by design: what the walls say, never a list of sites.
 */

/** Phrases (lower case, as whole words anywhere in the title) that only an interstitial's title has. */
const WALL_TITLES = [
  "just a moment",
  "attention required",
  "client challenge",
  "verify you are human",
  "verifying you are human",
  "are you a robot",
  "are you a human",
  "human verification",
  "bot verification",
  "checking your browser",
  "pardon our interruption",
  "request unsuccessful",
  "you have been blocked",
  "ddos-guard",
];

/**
 * Words a wall's title has, but a real page's may have too ("The Forbidden City", "How CAPTCHAs
 * work"). They count only on a page with little text, which a wall is and an article is not.
 */
const WALL_TITLE_WORDS = [
  "access denied",
  "security check",
  "one more step",
  "captcha",
  "forbidden",
];

/** Under this many characters of text, a title with one of WALL_TITLE_WORDS is taken for a wall. */
const SHORT_PAGE_TEXT = 1500;

/** `phrase` in `title` as whole words: "security check" is not in "security checklist". */
function hasPhrase(title: string, phrase: string): boolean {
  const letter = /[\p{L}\p{N}]/u;
  // Every occurrence: the first may be inside a longer word and a later one stand alone.
  for (let at = title.indexOf(phrase); at >= 0; at = title.indexOf(phrase, at + 1)) {
    const before = title[at - 1];
    const after = title[at + phrase.length];
    if (!(before && letter.test(before)) && !(after && letter.test(after))) return true;
  }
  return false;
}

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
  const body = (text ?? "").replace(/\s+/g, " ").trim();
  const wallTitle =
    WALL_TITLES.find((w) => hasPhrase(t, w)) ??
    (body.length < SHORT_PAGE_TEXT ? WALL_TITLE_WORDS.find((w) => hasPhrase(t, w)) : undefined);
  if (wallTitle) return `the title says "${title?.trim()}", an anti-bot page`;
  const head = body.slice(0, 600).toLowerCase();
  const phrase = WALL_PHRASES.find((p) => head.includes(p));
  if (phrase) return `the page says "${phrase}", an anti-bot page`;
  if (body.length < minText) {
    return `only ${body.length} characters of text (a login wall or an empty page?)`;
  }
  return null;
}

/** Path segments that only a login, consent or challenge page has. */
const WALL_PATH =
  /(^|[/._-])(log-?in|sign-?in|signin|auth|sso|consent|captcha|challenge|cdn-cgi)([/._?#-]|$)/i;

/**
 * Why landing on `finalUrl` after asking for `requestedUrl` means the page itself was not served, or null.
 * A site that hides a page behind a login or sends unknown pages home answers 200 there, with plenty of
 * text, so the text checks alone let it through.
 */
export function redirectReason(
  requestedUrl: string,
  finalUrl: string | null | undefined,
): string | null {
  if (!finalUrl) return null;
  let asked: URL;
  let landed: URL;
  try {
    asked = new URL(requestedUrl);
    landed = new URL(finalUrl);
  } catch {
    return null;
  }
  // /index.html and / are the same page.
  const path = (u: URL) =>
    u.pathname.replace(/\/index\.[a-z0-9]+$/i, "/").replace(/\/+$/, "") || "/";
  const host = (u: URL) => u.hostname.replace(/^www\./, "");
  if (host(asked) === host(landed) && path(asked) === path(landed)) return null;
  if (WALL_PATH.test(landed.pathname) && !WALL_PATH.test(asked.pathname)) {
    return `redirected to ${landed.origin}${landed.pathname}, a login or challenge page`;
  }
  // On the same site only: a short link that lands on another site's home page asked for it.
  if (host(asked) === host(landed) && path(landed) === "/" && path(asked) !== "/") {
    return `redirected to the home page (${landed.origin}/), so the page itself is gone or hidden`;
  }
  return null;
}
