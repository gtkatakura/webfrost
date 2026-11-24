import { describe, expect, test } from "bun:test";
import { categorizeError, categorizeStatus, failureClass } from "./failure";

describe("categorizeError", () => {
  test("a name that does not exist is a dead domain; a resolver in trouble is not", () => {
    expect(categorizeError("getaddrinfo ENOTFOUND oldforum.example")).toBe("domain_not_found");
    expect(categorizeError("getaddrinfo ESERVFAIL example.com")).toBe("dns_error");
    expect(categorizeError("getaddrinfo EAI_AGAIN example.com")).toBe("dns_error");
    expect(categorizeError("getaddrinfo ETIMEOUT example.com")).toBe("dns_error");
  });

  test("network, TLS, timeout, redirects and the SSRF guard each get their own category", () => {
    expect(categorizeError("ECONNRESET: The socket connection was closed unexpectedly")).toBe(
      "network_error",
    );
    expect(categorizeError("ENETUNREACH: Was there a typo in the url or port?")).toBe(
      "network_error",
    );
    expect(categorizeError("Fetch timed out after 30000ms: https://x")).toBe("timeout");
    expect(categorizeError("ERR_TLS_CERT_ALTNAME_INVALID fetching https://x")).toBe("tls_error");
    expect(categorizeError("Too many redirects (max 10)")).toBe("redirect_loop");
    // The address guard refuses other things too, and none of them is a private address.
    expect(categorizeError("SSRF blocked: unsupported protocol ftp:")).toBe("unsupported_url");
    expect(categorizeError("SSRF blocked: empty hostname")).toBe("unsupported_url");
    expect(categorizeError("SSRF blocked: files.example.com did not resolve")).toBe("dns_error");
    expect(
      categorizeError("SSRF blocked: intranet.example resolves to private IPv4 10.0.0.5"),
    ).toBe("private_address");
    expect(categorizeError("SSRF blocked: localhost resolves to private IPv6 ::1")).toBe(
      "private_address",
    );
    expect(categorizeError("something else entirely")).toBe("error");
  });
});

describe("categorizeStatus", () => {
  test("maps the statuses that end a run", () => {
    expect(categorizeStatus(404)).toBe("page_not_found");
    expect(categorizeStatus(410)).toBe("page_not_found");
    expect(categorizeStatus(403)).toBe("access_denied");
    expect(categorizeStatus(429)).toBe("rate_limited");
    expect(categorizeStatus(503)).toBe("server_error");
    expect(categorizeStatus(522)).toBe("server_error");
    expect(categorizeStatus(406)).toBe("refused_client");
    expect(categorizeStatus(999)).toBe("refused_client");
  });
});

test("a dead domain is permanent: no retry is worth it", () => {
  expect(failureClass("domain_not_found")).toBe("permanent");
  expect(failureClass("rate_limited")).toBe("transient");
  expect(failureClass("access_denied")).toBe("blocked");
});
