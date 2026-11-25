import { describe, expect, test } from "bun:test";
import { parseHeaders, redirectAdvice } from "./proxy-headers";

describe("parseHeaders", () => {
  test("one header per line, names lower-cased, blank lines skipped", () => {
    expect(parseHeaders("X-Token: abc\r\n\n  CF-Access-Client-Id:  id.access  \n", "TEST")).toEqual(
      {
        "x-token": "abc",
        "cf-access-client-id": "id.access",
      },
    );
    expect(parseHeaders(undefined, "TEST")).toEqual({});
    expect(parseHeaders("   ", "TEST")).toEqual({});
    // A value may hold colons and spaces.
    expect(parseHeaders("x-when: 2026-11-24T10:00:00Z a b", "TEST")).toEqual({
      "x-when": "2026-11-24T10:00:00Z a b",
    });
  });

  test("a line that is not a header is an error that never repeats the value", () => {
    for (const raw of [
      "no colon here",
      ": value",
      "bad name: v",
      "x-empty:",
      "x-ok: a\nsecret-without-colon",
    ]) {
      expect(() => parseHeaders(raw, "WEBFROST_HEADERS")).toThrow("WEBFROST_HEADERS");
    }
    try {
      parseHeaders("x-token: s3cr3t\u0007", "WEBFROST_HEADERS");
      throw new Error("expected an error");
    } catch (err) {
      expect((err as Error).message).not.toContain("s3cr3t");
    }
  });

  test("the headers the command line sets itself cannot be given", () => {
    for (const name of ["Authorization", "cookie", "Host", "content-type", "Content-Length"]) {
      expect(() => parseHeaders(`${name}: x`, "WEBFROST_HEADERS")).toThrow(name.toLowerCase());
    }
  });
});

describe("redirectAdvice", () => {
  const redirect = (location: string | null) =>
    new Response(null, { status: 302, headers: location ? { location } : {} });

  test("names where the redirect goes, by host only, and what to do", () => {
    const advice = redirectAdvice(redirect("https://sso.example/login?next=/secret&token=abc"));
    expect(advice).toContain("to sso.example");
    expect(advice).not.toContain("token=abc");
    expect(advice).toContain("--headers-command");
    expect(advice).toContain("WEBFROST_HEADERS");
  });

  test("a missing or odd Location is left out, not printed", () => {
    expect(redirectAdvice(redirect(null))).toContain("with a redirect (HTTP 302)");
    expect(redirectAdvice(redirect("/relative"))).toContain("with a redirect (HTTP 302)");
  });
});

describe("the headers command", () => {
  test("a helper that leaves something running does not hang the command line", async () => {
    const { headersCommandFor } = await import("./proxy-headers");
    void headersCommandFor;
    const { prepareServer, proxyHeaders } = await import("./proxy-headers");
    const base = new URL("http://headers-bg.example");
    const started = Date.now();
    await prepareServer(base, "printf 'x-token: abc\\n'; sleep 30 &");
    expect(proxyHeaders(base)).toEqual({ "x-token": "abc" });
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15_000);
});
