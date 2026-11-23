import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { decodeContentEncoding, decodeText, isTextualContentType } from "./http-body";

const TEXT = "Glaciers remember. ".repeat(50);
const bytes = new TextEncoder().encode(TEXT);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("decodeContentEncoding", () => {
  test("undoes gzip, deflate (zlib and raw), br and zstd", () => {
    expect(text(decodeContentEncoding(zlib.gzipSync(bytes), "gzip"))).toBe(TEXT);
    expect(text(decodeContentEncoding(zlib.deflateSync(bytes), "deflate"))).toBe(TEXT);
    expect(text(decodeContentEncoding(zlib.deflateRawSync(bytes), "deflate"))).toBe(TEXT);
    expect(text(decodeContentEncoding(zlib.brotliCompressSync(bytes), "br"))).toBe(TEXT);
    expect(text(decodeContentEncoding(zlib.zstdCompressSync(bytes), "zstd"))).toBe(TEXT);
  });

  test("undoes stacked codings in reverse order", () => {
    const stacked = zlib.brotliCompressSync(zlib.gzipSync(bytes));
    expect(text(decodeContentEncoding(stacked, "gzip, br"))).toBe(TEXT);
  });

  test("passes identity through and rejects unknown codings", () => {
    expect(decodeContentEncoding(bytes, null)).toBe(bytes);
    expect(text(decodeContentEncoding(bytes, "identity"))).toBe(TEXT);
    expect(() => decodeContentEncoding(bytes, "compress")).toThrow("unsupported");
  });

  test("refuses more than three stacked codings before decoding any", () => {
    let layered: Uint8Array = bytes;
    for (let i = 0; i < 3; i++) layered = zlib.gzipSync(layered);
    expect(text(decodeContentEncoding(layered, "gzip, gzip, gzip"))).toBe(TEXT);
    const four = zlib.gzipSync(layered);
    expect(() => decodeContentEncoding(four, "gzip, gzip, gzip, gzip")).toThrow(
      "too many content-codings",
    );
    // Hundreds of entries in the header cost nothing.
    const many = Array.from({ length: 500 }, () => "gzip").join(", ");
    expect(() => decodeContentEncoding(four, many)).toThrow("too many content-codings");
  });

  test("shares one output budget across stacked codings", () => {
    // Incompressible data: every layer inflates to about 40 MB, 120 MB in all.
    const random = crypto.randomBytes(40 * 1024 * 1024);
    let layered: Uint8Array = random;
    for (let i = 0; i < 3; i++) layered = zlib.gzipSync(layered, { level: 1 });
    expect(() => decodeContentEncoding(layered, "gzip, gzip, gzip")).toThrow();
    // Two layers fit the budget.
    const two = zlib.gzipSync(zlib.gzipSync(random, { level: 1 }), { level: 1 });
    expect(decodeContentEncoding(two, "gzip, gzip").byteLength).toBe(random.byteLength);
  }, 30_000);
});

describe("decodeText", () => {
  const latin1 = Buffer.from("Crème brûlée", "latin1");

  test("uses the Content-Type charset", () => {
    expect(decodeText(latin1, "text/html; charset=ISO-8859-1")).toBe("Crème brûlée");
  });

  test("falls back to <meta charset> and <meta http-equiv>", () => {
    const meta = Buffer.concat([Buffer.from('<meta charset="latin1">'), latin1]);
    expect(decodeText(meta, "text/html")).toContain("Crème brûlée");
    const equiv = Buffer.concat([
      Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'),
      latin1,
    ]);
    expect(decodeText(equiv, null)).toContain("Crème brûlée");
  });

  test("a BOM wins, an unknown label falls back to UTF-8", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("é")]);
    expect(decodeText(bom, "text/html; charset=iso-8859-1")).toBe("é");
    expect(decodeText(new TextEncoder().encode("é"), "text/html; charset=x-nope")).toBe("é");
  });
});

describe("isTextualContentType", () => {
  test("text, markup and JSON are text; PDFs and images are not", () => {
    for (const t of [
      null,
      "text/html",
      "application/xhtml+xml",
      "application/json",
      "text/plain",
    ]) {
      expect(isTextualContentType(t)).toBe(true);
    }
    for (const t of ["application/pdf", "image/png", "video/mp4", "application/octet-stream"]) {
      expect(isTextualContentType(t)).toBe(false);
    }
  });
});
