/**
 * Dialect-independent pieces of full-text search for PostgreSQL and MySQL:
 * tokenisation, query parsing and snippet building. SQLite uses FTS5 directly.
 *
 * Tokenisation mirrors FTS5's default `unicode61` tokenizer — runs of Unicode
 * letters and digits, case-folded, diacritics removed — so "https://example.com/a-b"
 * indexes as `https example com a b` on every database, and a query matches the
 * same documents whichever engine runs it.
 */

/** Sentinels marking highlights in a raw snippet; see `renderSnippet` in search.ts. */
export const MARK_OPEN = "\u0001";
export const MARK_CLOSE = "\u0002";

const TOKEN = /[\p{L}\p{N}]+/gu;

/**
 * Case-fold and strip diacritics. This runs before the text is split into tokens:
 * NFKD turns some characters into text that is not a letter or digit ("⑴" into
 * "(1)"), and those must end up as separators, never inside a token.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

export function tokenize(text: string): string[] {
  return fold(text).match(TOKEN) ?? [];
}

/** The text a PostgreSQL tsvector / MySQL FULLTEXT index is built from. */
export function searchDocument(parts: string[]): string[] {
  return parts.flatMap(tokenize);
}

/**
 * Trim a token stream so PostgreSQL can build a tsvector from it (the type is
 * capped at 1 MB). The estimate follows the on-disk layout: a 4-byte entry and
 * the lexeme per distinct word, 2 bytes per position, at most 256 positions each.
 * Real pages never get near it; a multi-megabyte text dump is indexed on its
 * first ~900 KB of tsvector.
 */
export function capForTsvector(tokens: string[], maxBytes = 900_000): string[] {
  const positions = new Map<string, number>();
  let size = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const seen = positions.get(token);
    if (seen === undefined) {
      size += 4 + Buffer.byteLength(token) + 2 + 1;
      positions.set(token, 1);
    } else if (seen < 256) {
      size += 2;
      positions.set(token, seen + 1);
    }
    if (size > maxBytes) return tokens.slice(0, i);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export interface QueryTerm {
  /** Normalised tokens; more than one means a phrase. */
  words: string[];
  /** `term*`: match words starting with the (single) token. */
  prefix: boolean;
}

/** Alternatives joined by OR; a negated clause excludes documents. */
export interface QueryClause {
  negate: boolean;
  alternatives: QueryTerm[];
}

/** Longest query read, and most terms kept: a longer query only costs time. */
export const MAX_QUERY_LENGTH = 512;
export const MAX_QUERY_TERMS = 32;

const COLUMN_PREFIX = /^(url|title|text_content|tags):/i;

/**
 * Parse the subset of FTS5 query syntax people actually type: words, "quoted
 * phrases", `prefix*`, `OR`, `AND`, `NOT word` / `-word`. Column filters
 * (`title:word`) are accepted and search every column. Returns an empty list
 * when nothing positive is left to search for.
 */
export function parseSearchQuery(query: string): QueryClause[] {
  const clauses: QueryClause[] = [];
  let pendingOr = false;
  let pendingNot = false;
  let terms = 0;
  for (const match of query.slice(0, MAX_QUERY_LENGTH).matchAll(/"([^"]*)"?|(\S+)/g)) {
    const quoted = match[1];
    let raw = match[2];
    if (raw === "OR") {
      pendingOr = clauses.length > 0;
      continue;
    }
    if (raw === "AND") continue;
    if (raw === "NOT") {
      pendingNot = true;
      continue;
    }

    let negate = pendingNot;
    let term: QueryTerm | null = null;
    if (quoted !== undefined) {
      const words = tokenize(quoted);
      if (words.length > 0) term = { words, prefix: false };
    } else if (raw !== undefined) {
      raw = raw.replace(/^[()]+|[()]+$/g, "");
      if (raw.startsWith("-") && raw.length > 1) {
        negate = true;
        raw = raw.slice(1);
      }
      raw = raw.replace(/^\+/, "").replace(COLUMN_PREFIX, "");
      const prefix = raw.endsWith("*");
      const words = tokenize(raw);
      if (words.length > 0) term = { words, prefix: prefix && words.length === 1 };
    }
    pendingNot = false;
    if (!term) {
      pendingOr = false;
      continue;
    }
    if (++terms > MAX_QUERY_TERMS) break;

    const last = clauses[clauses.length - 1];
    if (pendingOr && last && !last.negate && !negate) {
      last.alternatives.push(term);
    } else {
      clauses.push({ negate, alternatives: [term] });
    }
    pendingOr = false;
  }
  return clauses.some((c) => !c.negate) ? clauses : [];
}

/** PostgreSQL `to_tsquery('simple', …)` input. Tokens are letters/digits only, so quoting is safe. */
export function toTsquery(clauses: QueryClause[]): string {
  const term = (t: QueryTerm): string =>
    t.words.length > 1
      ? `(${t.words.map((w) => `'${w}'`).join(" <-> ")})`
      : `'${t.words[0]}'${t.prefix ? ":*" : ""}`;
  return clauses
    .map((c) => {
      const body =
        c.alternatives.length > 1
          ? `(${c.alternatives.map(term).join(" | ")})`
          : term(c.alternatives[0] as QueryTerm);
      return c.negate ? `!${body}` : body;
    })
    .join(" & ");
}

/**
 * SQLite FTS5 `MATCH` input. Every term is a quoted phrase (tokens are letters and digits, so the
 * quotes are safe), a prefix gets `*` after its closing quote, and nothing else of FTS5's syntax
 * (NEAR, column filters, ^) can be written: one query cannot ask for more than MAX_QUERY_TERMS
 * terms, however long it is. FTS5's NOT is binary, so the negated clauses come last.
 */
export function toFts5(clauses: QueryClause[]): string {
  const term = (t: QueryTerm): string => `"${t.words.join(" ")}"${t.prefix ? "*" : ""}`;
  const body = (c: QueryClause): string =>
    c.alternatives.length > 1
      ? `(${c.alternatives.map(term).join(" OR ")})`
      : term(c.alternatives[0] as QueryTerm);
  const positive = clauses
    .filter((c) => !c.negate)
    .map(body)
    .join(" AND ");
  const negative = clauses
    .filter((c) => c.negate)
    .map((c) => ` NOT ${body(c)}`)
    .join("");
  return `${positive}${negative}`;
}

/** MySQL `MATCH … AGAINST (… IN BOOLEAN MODE)` input. */
export function toMysqlBoolean(clauses: QueryClause[]): string {
  const term = (t: QueryTerm): string =>
    t.words.length > 1 ? `"${t.words.join(" ")}"` : `${t.words[0]}${t.prefix ? "*" : ""}`;
  return clauses
    .map((c) => {
      const body =
        c.alternatives.length > 1
          ? `(${c.alternatives.map(term).join(" ")})`
          : term(c.alternatives[0] as QueryTerm);
      return `${c.negate ? "-" : "+"}${body}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/** Characters of a document a snippet is built from; text past it is not searched for a window. */
export const MAX_SNIPPET_SOURCE = 100_000;

/**
 * Build a highlighted excerpt the way FTS5's `snippet(…, '…', 32)` does: the
 * window of at most `maxTokens` tokens with the most distinct query terms, hits
 * wrapped in the MARK sentinels, "…" where text was cut off. Text with no hit
 * yields its opening tokens.
 */
export function buildSnippet(text: string, clauses: QueryClause[], maxTokens = 32): string {
  const clean = text
    .slice(0, MAX_SNIPPET_SOURCE)
    .replaceAll(MARK_OPEN, "")
    .replaceAll(MARK_CLOSE, "");
  const tokens = [...clean.matchAll(TOKEN)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    // Usually one word; a few characters fold into several ("½" into "1", "2").
    norm: tokenize(m[0]),
  }));
  if (tokens.length === 0) return "";

  // Exact words go in a map, prefixes in a short list; both deduplicated and
  // numbered by first appearance, so a token's hit is the first term it matches.
  const exact = new Map<string, number>();
  const prefixes = new Map<string, number>();
  let n = 0;
  for (const clause of clauses) {
    if (clause.negate) continue;
    for (const t of clause.alternatives) {
      t.words.forEach((word, i) => {
        const target = t.prefix && i === t.words.length - 1 ? prefixes : exact;
        if (!target.has(word)) target.set(word, n);
        n++;
      });
    }
  }
  const hitOf = (words: string[]): number => {
    let best = -1;
    for (const w of words) {
      const e = exact.get(w);
      if (e !== undefined && (best < 0 || e < best)) best = e;
      for (const [p, idx] of prefixes) {
        if ((best < 0 || idx < best) && w.startsWith(p)) best = idx;
      }
    }
    return best;
  };
  const hits = tokens.map((t) => hitOf(t.norm));

  // Best window: most distinct terms, then most hits, then earliest.
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (hits[i] === -1 && !(i === 0 && bestScore < 0)) continue;
    const seen = new Set<number>();
    let count = 0;
    for (let j = i; j < Math.min(tokens.length, i + maxTokens); j++) {
      const h = hits[j] as number;
      if (h >= 0) {
        seen.add(h);
        count++;
      }
    }
    const score = seen.size * 1000 + count;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Centre the hits in the window, as far as the text allows.
  let lastHit = best;
  for (let j = best; j < Math.min(tokens.length, best + maxTokens); j++) {
    if ((hits[j] as number) >= 0) lastHit = j;
  }
  const span = lastHit - best + 1;
  const start = Math.max(
    0,
    Math.min(best - Math.floor((maxTokens - span) / 2), tokens.length - maxTokens),
  );
  const end = Math.min(tokens.length, start + maxTokens) - 1;

  let out = start > 0 ? "…" : "";
  let cursor = start > 0 ? (tokens[start] as { start: number }).start : 0;
  for (let i = start; i <= end; i++) {
    const tok = tokens[i] as { start: number; end: number };
    out += clean.slice(cursor, tok.start);
    const word = clean.slice(tok.start, tok.end);
    out += (hits[i] as number) >= 0 ? `${MARK_OPEN}${word}${MARK_CLOSE}` : word;
    cursor = tok.end;
  }
  out += end < tokens.length - 1 ? "…" : clean.slice(cursor);
  return out;
}
