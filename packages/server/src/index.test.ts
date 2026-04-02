import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("GET /health", () => {
  test("returns 200 { status: ok }", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("security headers", () => {
  test("sets Content-Security-Policy on every response", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("sets X-Content-Type-Options: nosniff", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("sets X-Frame-Options: DENY", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("sets Referrer-Policy", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
