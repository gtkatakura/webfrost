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

  test("the same page, a moved page or no redirect at all is fine", () => {
    expect(redirectReason("http://ex.com/a", "https://www.ex.com/a/")).toBeNull();
    expect(redirectReason("https://ex.com/old", "https://ex.com/new-slug")).toBeNull();
    expect(redirectReason("https://bit.ly/x", "https://ex.com/article")).toBeNull();
    expect(redirectReason("https://ex.com/", "https://ex.com/")).toBeNull();
    expect(redirectReason("https://ex.com/login", "https://ex.com/login/")).toBeNull();
    expect(redirectReason("https://ex.com/a", null)).toBeNull();
  });
});
