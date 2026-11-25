import { describe, expect, test } from "bun:test";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MAX_QUERY_TERMS,
  buildSnippet,
  capForTsvector,
  parseSearchQuery,
  searchDocument,
  toFts5,
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

describe("toFts5", () => {
  test("every term is a quoted phrase; prefix, OR and NOT keep their meaning", () => {
    expect(toFts5(parseSearchQuery("climate change"))).toBe(`"climate" AND "change"`);
    expect(toFts5(parseSearchQuery(`"sea ice" melt* -arctic`))).toBe(
      `"sea ice" AND "melt"* NOT "arctic"`,
    );
    expect(toFts5(parseSearchQuery("rust OR go"))).toBe(`("rust" OR "go")`);
  });

  test("FTS5 syntax that could make a query expensive is not passed through", () => {
    // NEAR groups and column filters become plain words and phrases.
    expect(toFts5(parseSearchQuery("NEAR(a b, 2) title:quokka"))).toBe(
      `"near a" AND "b" AND "2" AND "quokka"`,
    );
    // Thousands of prefix terms: at most MAX_QUERY_TERMS reach SQLite.
    const huge = Array.from({ length: 5000 }, (_, i) => `t${i}*`).join(" OR ");
    expect(toFts5(parseSearchQuery(huge)).split(" OR ").length).toBeLessThanOrEqual(
      MAX_QUERY_TERMS,
    );
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
