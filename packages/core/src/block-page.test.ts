import { describe, expect, test } from "bun:test";
import { blockPageReason, redirectReason } from "./block-page";

const article = "A real article. ".repeat(20);

describe("blockPageReason", () => {
  test("anti-bot interstitials, by title", () => {
    for (const title of [
      "Just a moment...",
      "Attention Required! | Cloudflare",
      "Client Challenge",
      "Access Denied",
      "Pardon Our Interruption",
      "DDoS-Guard",
    ]) {
      expect(blockPageReason(title, article)).toContain("anti-bot");
    }
  });

  test("a common word in the title is a wall only on a page with little text", () => {
    const long = "A real article about the subject, with paragraphs of text. ".repeat(40);
    // Real pages whose title happens to hold a wall's word.
    expect(blockPageReason("The Forbidden City - Wikipedia", long)).toBeNull();
    expect(blockPageReason("How CAPTCHAs work", long)).toBeNull();
    expect(blockPageReason("Access denied: a history of paywalls", long)).toBeNull();
    // A word that only starts like one is never a match, whatever the length.
    expect(blockPageReason("Security Checklist for Small Teams", article)).toBeNull();
    expect(blockPageReason("Security Checklist for Small Teams", long)).toBeNull();
    // The walls themselves: the same words over a few lines of text.
    for (const title of ["403 Forbidden", "Access Denied", "Security check", "One more step"]) {
      expect(blockPageReason(title, article)).toContain("anti-bot");
    }
    // The word standing alone later in the title counts, also after a longer word that starts like it.
    expect(blockPageReason("Security checklist: security check", article)).toContain("anti-bot");
    // An unmistakable wall title needs no second signal.
    expect(blockPageReason("Just a moment...", long)).toContain("anti-bot");
  });

  test("anti-bot interstitials, by what the page says", () => {
    expect(
      blockPageReason("example.com", `Enable JavaScript and cookies to continue ${article}`),
    ).toContain("anti-bot");
  });

  test("a page with almost no text is a wall", () => {
    expect(blockPageReason("Reddit", "Log in to continue")).toContain("characters of text");
    expect(blockPageReason("Reddit", null)).toContain("0 characters");
  });

  test("a real page passes, and the minimum is adjustable", () => {
    expect(blockPageReason("Atom vs Brackets vs Light Table vs Sublime Text", article)).toBeNull();
    expect(blockPageReason("Tiny", "short but real", 0)).toBeNull();
  });
});

describe("redirectReason", () => {
  test("a redirect to a login or challenge page, or to the home page, is not the page", () => {
    expect(redirectReason("https://ex.com/post/1", "https://ex.com/login?next=/post/1")).toContain(
      "login",
    );
    expect(redirectReason("https://ex.com/post/1", "https://accounts.ex.com/signin/v2")).toContain(
      "login",
    );
    expect(
      redirectReason("https://ex.com/post/1", "https://ex.com/cdn-cgi/challenge-platform"),
    ).toContain("challenge");
    expect(redirectReason("https://ex.com/post/1", "https://ex.com/")).toContain("home page");
  });

  test("an index page and its directory are the same page; another site's home page was asked for", () => {
    expect(redirectReason("https://a.example/index.html", "https://a.example/")).toBeNull();
    expect(
      redirectReason("https://a.example/docs/index.php", "https://a.example/docs/"),
    ).toBeNull();
    // A short link that resolves to a site's home page is that page.
    expect(redirectReason("https://sho.rt/x7Kq", "https://a.example/")).toBeNull();
    // Sent home by the same site: the page is gone or hidden.
    expect(redirectReason("https://a.example/post/1", "https://www.a.example/")).toContain(
      "home page",
    );
  });

  test("the same page, a moved page or no redirect at all is fine", () => {
    expect(redirectReason("http://ex.com/a", "https://www.ex.com/a/")).toBeNull();
    expect(redirectReason("https://ex.com/old", "https://ex.com/new-slug")).toBeNull();
    expect(redirectReason("https://bit.ly/x", "https://ex.com/article")).toBeNull();
    expect(redirectReason("https://ex.com/", "https://ex.com/")).toBeNull();
    expect(redirectReason("https://ex.com/login", "https://ex.com/login/")).toBeNull();
    expect(redirectReason("https://ex.com/a", null)).toBeNull();
  });
});
