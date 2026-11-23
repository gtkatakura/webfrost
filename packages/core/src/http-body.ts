/**
 * Turning an HTTP body as received (still content-encoded, bytes in some charset)
 * into the text the HTML and Readability extractors work on.
 */
import zlib from "node:zlib";

/** Decoded bodies larger than this are refused (protects against compression bombs). */
const MAX_DECODED_BYTES = 50 * 1024 * 1024;
/** More stacked codings than this are refused: each one is a full synchronous pass. */
const MAX_CODINGS = 3;
/** Output budget shared by all passes, so stacked codings cannot multiply the work. */
const MAX_TOTAL_DECODED_BYTES = 2 * MAX_DECODED_BYTES;

/**
 * Undo the Content-Encoding of `body` ("gzip", "br", "deflate", "zstd", or a list such
 * as "gzip, br" applied in that order). Returns the body unchanged for identity or a
 * missing header. Throws for an unknown coding, more than three codings, corrupt data or
 * an oversized result.
 */
export function decodeContentEncoding(
  body: Uint8Array,
  contentEncoding: string | null,
): Uint8Array {
  if (!contentEncoding) return body;
  const codings = contentEncoding
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c && c !== "identity");
  if (codings.length > MAX_CODINGS) {
    throw new Error(`too many content-codings: ${codings.length} (max ${MAX_CODINGS})`);
  }
  let out: Uint8Array = body;
  let budget = MAX_TOTAL_DECODED_BYTES;
  // Codings are listed in the order they were applied, so undo them from the end.
  for (const coding of codings.reverse()) {
    if (budget <= 0) throw new Error("decoded body too large");
    const opts = { maxOutputLength: Math.min(MAX_DECODED_BYTES, budget) };
    switch (coding) {
      case "gzip":
      case "x-gzip":
        out = zlib.gunzipSync(out, opts);
        break;
      case "deflate":
        // "deflate" is meant to be zlib-wrapped, but some servers send raw deflate.
        try {
          out = zlib.inflateSync(out, opts);
        } catch {
          out = zlib.inflateRawSync(out, opts);
        }
        break;
      case "br":
        out = zlib.brotliDecompressSync(out, opts);
        break;
      case "zstd":
        out = zlib.zstdDecompressSync(out, opts);
        break;
      default:
        throw new Error(`unsupported content-encoding: ${coding}`);
    }
    budget -= out.byteLength;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** The `charset` parameter of a Content-Type header, if any. */
function charsetFromContentType(contentType: string | null): string | null {
  const m = /;\s*charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType ?? "");
  return m?.[1] ?? null;
}

/** A charset declared by a byte order mark. */
function charsetFromBom(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

/** `<meta charset>` or `<meta http-equiv="Content-Type" content="...; charset=...">` near the top. */
function charsetFromMeta(bytes: Uint8Array): string | null {
  // The HTML spec looks at the first 1024 bytes; be a little more lenient.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const direct = /\bcharset\s*=\s*["']?([^"'\s/>;]+)/i.exec(tag);
    if (direct?.[1]) return direct[1];
  }
  return null;
}

function decoderFor(label: string | null): TextDecoder | null {
  if (!label) return null;
  try {
    return new TextDecoder(label.toLowerCase());
  } catch {
    // Unknown (or unsupported by this runtime) charset label.
    return null;
  }
}

/**
 * Decode `bytes` as text using, in order: a byte order mark, the Content-Type charset,
 * a `<meta>` charset declaration (for HTML), and finally UTF-8.
 */
export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  const isHtml = /html|xml/i.test(contentType ?? "") || !contentType;
  const decoder =
    decoderFor(charsetFromBom(bytes)) ??
    decoderFor(charsetFromContentType(contentType)) ??
    (isHtml ? decoderFor(charsetFromMeta(bytes)) : null) ??
    new TextDecoder("utf-8");
  return decoder.decode(bytes);
}

/**
 * True when a response with this Content-Type is text the HTML and Readability
 * extractors can use. A missing Content-Type counts as text (it usually is HTML).
 */
export function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    mime === "" ||
    mime.startsWith("text/") ||
    mime.includes("html") ||
    mime.includes("xml") ||
    mime.includes("json") ||
    mime.includes("javascript")
  );
}
