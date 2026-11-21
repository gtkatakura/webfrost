import { describe, expect, test } from "bun:test";
import {
  MARK_CLOSE,
  MARK_OPEN,
  buildSnippet,
  capForTsvector,
  parseSearchQuery,
  searchDocument,
  toMysqlBoolean,
  toTsquery,
  tokenize,
} from "./search-text";

const mark = (raw: string) => raw.replaceAll(MARK_OPEN, "[").replaceAll(MARK_CLOSE, "]");

describe("tokenize", () => {
  test("splits like FTS5 unicode61: letters and digits, case-folded, no diacritics", () => {
    expect(tokenize("https://Example.com/a-b?q=Café_42")).toEqual([
      "https",
      "example",
      "com",
      "a",
      "b",
      "q",
      "cafe",
      "42",
    ]);
    expect(searchDocument(["Über", "naïve tags"])).toEqual(["uber", "naive", "tags"]);
  });
});

describe("parseSearchQuery", () => {
  test("words, phrases, prefixes, OR and negation", () => {
    expect(parseSearchQuery('archiving "web page" tool* OR kit -spam NOT junk')).toEqual([
      { negate: false, alternatives: [{ words: ["archiving"], prefix: false }] },
      { negate: false, alternatives: [{ words: ["web", "page"], prefix: false }] },
      {
        negate: false,
        alternatives: [
          { words: ["tool"], prefix: true },
          { words: ["kit"], prefix: false },
        ],
      },
      { negate: true, alternatives: [{ words: ["spam"], prefix: false }] },
      { negate: true, alternatives: [{ words: ["junk"], prefix: false }] },
    ]);
  });

  test("column filters search every column; punctuation splits words into a phrase", () => {
    expect(parseSearchQuery("title:glacier foo-bar")).toEqual([
      { negate: false, alternatives: [{ words: ["glacier"], prefix: false }] },
      { negate: false, alternatives: [{ words: ["foo", "bar"], prefix: false }] },
    ]);
  });

  test("nothing positive to search for yields no clauses", () => {
    expect(parseSearchQuery("-spam")).toEqual([]);
    expect(parseSearchQuery('"" ***')).toEqual([]);
    // An unclosed quote is read to the end of the query.
    expect(parseSearchQuery('"unclosed')).toEqual([
      { negate: false, alternatives: [{ words: ["unclosed"], prefix: false }] },
    ]);
  });

  test("renders engine-specific syntax that cannot be injected into", () => {
    const clauses = parseSearchQuery('it\'s "web page" tool* OR kit -spam');
    // "it's" splits into a phrase, as punctuation does inside an indexed word.
    expect(toTsquery(clauses)).toBe(
      "('it' <-> 's') & ('web' <-> 'page') & ('tool':* | 'kit') & !'spam'",
    );
    expect(toMysqlBoolean(clauses)).toBe('+"it s" +"web page" +(tool* kit) -spam');
  });
});

describe("buildSnippet", () => {
  test("highlights hits in a window of at most 32 tokens, with ellipses where text was cut", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    words[60] = "glacier";
    const snippet = mark(buildSnippet(words.join(" "), parseSearchQuery("glacier")));
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("[glacier]");
    expect(snippet.replace(/…/g, "").trim().split(/\s+/)).toHaveLength(32);
  });

  test("short text is returned whole; prefixes and case-insensitive matches are marked", () => {
    expect(mark(buildSnippet("Frostbite & frosty <b>", parseSearchQuery("frost*")))).toBe(
      "[Frostbite] & [frosty] <b>",
    );
  });

  test("text without a hit yields its opening; empty text yields nothing", () => {
    const text = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
    const snippet = buildSnippet(text, parseSearchQuery("absent"));
    expect(snippet.startsWith("t0 ")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(buildSnippet("", parseSearchQuery("x"))).toBe("");
  });

  test("sentinel characters in the archived text cannot fake a highlight", () => {
    expect(buildSnippet(`a ${MARK_OPEN}b${MARK_CLOSE} c`, parseSearchQuery("zzz"))).toBe("a b c");
  });
});

describe("capForTsvector", () => {
  test("keeps ordinary documents whole and trims pathological ones", () => {
    const normal = tokenize("the quick brown fox ".repeat(10_000));
    expect(capForTsvector(normal)).toHaveLength(normal.length);
    const unique = Array.from({ length: 200_000 }, (_, i) => `token${i}`);
    const capped = capForTsvector(unique);
    expect(capped.length).toBeLessThan(unique.length);
    expect(capped.length).toBeGreaterThan(10_000);
  });
});
