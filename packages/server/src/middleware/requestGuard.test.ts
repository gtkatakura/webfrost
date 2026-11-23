import { describe, expect, test } from "bun:test";
import { checkApiRequest, isSameOriginRequest } from "./requestGuard";

const JSON_HEADERS = { "content-type": "application/json" };

function post(path: string, headers: Record<string, string>, body: BodyInit | null = "{}") {
  return new Request(`http://archive.example${path}`, { method: "POST", headers, body });
}

describe("isSameOriginRequest", () => {
  test("accepts same-origin and user-initiated fetch metadata", () => {
    for (const site of ["same-origin", "none"]) {
      expect(isSameOriginRequest(post("/api/v1/tags", { "sec-fetch-site": site }))).toBe(true);
    }
  });

  test("rejects same-site and cross-site requests", () => {
    for (const site of ["same-site", "cross-site"]) {
      expect(isSameOriginRequest(post("/api/v1/tags", { "sec-fetch-site": site }))).toBe(false);
    }
  });

  test("without fetch metadata, Origin must match Host", () => {
    const req = (origin: string) => post("/api/v1/tags", { origin, host: "archive.example" });
    expect(isSameOriginRequest(req("https://archive.example"))).toBe(true);
    expect(isSameOriginRequest(req("https://evil.example"))).toBe(false);
    expect(isSameOriginRequest(req("https://sub.archive.example"))).toBe(false);
    expect(isSameOriginRequest(req("null"))).toBe(false);
  });

  test("a request with neither header is not from a browser and passes", () => {
    expect(isSameOriginRequest(post("/api/v1/tags", {}))).toBe(true);
  });
});

describe("checkApiRequest", () => {
  test("rejects a cross-site form post carrying a session cookie", () => {
    const refusal = checkApiRequest(
      post(
        "/api/v1/snapshots",
        {
          "content-type": "application/x-www-form-urlencoded",
          cookie: "session=abc",
          "sec-fetch-site": "same-site",
        },
        "url=https://example.com",
      ),
    );
    expect(refusal?.status).toBe(403);
    expect(refusal?.code).toBe("CROSS_ORIGIN_REQUEST");
  });

  test("Bearer requests skip the origin check (forms cannot send the header)", () => {
    expect(
      checkApiRequest(
        post("/api/v1/tags", {
          ...JSON_HEADERS,
          authorization: "Bearer key",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBeNull();
  });

  test("a Bearer request that also carries a session cookie still gets the origin check", () => {
    const refusal = checkApiRequest(
      post("/api/v1/tags", {
        ...JSON_HEADERS,
        authorization: "Bearer proxy-token",
        cookie: "session=abc",
        "sec-fetch-site": "same-site",
      }),
    );
    expect(refusal?.code).toBe("CROSS_ORIGIN_REQUEST");
  });

  test("safe methods and non-API paths are never checked", () => {
    expect(
      checkApiRequest(
        new Request("http://archive.example/api/tags", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBeNull();
    expect(checkApiRequest(post("/health", { "sec-fetch-site": "cross-site" }))).toBeNull();
  });

  test("same-origin form encodings are refused with 415", () => {
    for (const type of [
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "text/plain",
    ]) {
      const refusal = checkApiRequest(
        post("/api/v1/tags", { "content-type": type, "sec-fetch-site": "same-origin" }, "name=x"),
      );
      expect(refusal?.status).toBe(415);
      expect(refusal?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  test("JSON with parameters is accepted", () => {
    expect(
      checkApiRequest(post("/api/v1/tags", { "content-type": "application/json; charset=utf-8" })),
    ).toBeNull();
  });

  test("bodyless writes (DELETE, logout) need no content type", () => {
    expect(
      checkApiRequest(
        new Request("http://archive.example/api/tags/1", {
          method: "DELETE",
          headers: { "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBeNull();
    expect(checkApiRequest(post("/api/v1/auth/logout", {}, null))).toBeNull();
  });

  test("a body without a content type is refused", () => {
    const refusal = checkApiRequest(
      new Request("http://archive.example/api/tags", {
        method: "POST",
        headers: { "content-length": "2" },
        body: "{}",
      }),
    );
    expect(refusal?.status).toBe(415);
  });

  test("the file import takes multipart only, and only up to the import limit", () => {
    expect(
      checkApiRequest(
        post("/api/v1/import/file", { "content-type": "multipart/form-data; boundary=x" }),
      ),
    ).toBeNull();
    expect(checkApiRequest(post("/api/v1/import/file", JSON_HEADERS))?.status).toBe(415);
    const big = checkApiRequest(
      post("/api/v1/import/file", {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(50 * 1024 * 1024),
      }),
    );
    expect(big?.status).toBe(413);
    expect(big?.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("snapshot bundle import and body limits", () => {
  const ZIP = { "content-type": "application/zip" };

  test("the bundle import takes application/zip only, chunked or up to the bundle limit", () => {
    expect(checkApiRequest(post("/api/v1/snapshots/import", ZIP))).toBeNull();
    expect(
      checkApiRequest(post("/api/v1/snapshots/import", { ...ZIP, "transfer-encoding": "chunked" })),
    ).toBeNull();
    expect(checkApiRequest(post("/api/v1/snapshots/import", JSON_HEADERS))?.status).toBe(415);
    const huge = { ...ZIP, "content-length": String(5 * 1024 ** 3) };
    expect(checkApiRequest(post("/api/v1/snapshots/import", huge))?.status).toBe(413);
    // A 100 MB video bundle is within the default 2 GiB.
    const video = { ...ZIP, "content-length": String(100 * 1024 ** 2) };
    expect(checkApiRequest(post("/api/v1/snapshots/import", video))).toBeNull();
  });

  test("other routes keep the small body limit and must declare their length", () => {
    const big = { ...JSON_HEADERS, "content-length": String(100 * 1024 ** 2) };
    expect(checkApiRequest(post("/api/v1/auth/login", big))?.status).toBe(413);
    const chunked = { ...JSON_HEADERS, "transfer-encoding": "chunked" };
    expect(checkApiRequest(post("/api/v1/auth/login", chunked))?.status).toBe(411);
  });
});
