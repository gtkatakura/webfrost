import { describe, expect, test } from "bun:test";
import { blockPageReason } from "./block-page";

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
