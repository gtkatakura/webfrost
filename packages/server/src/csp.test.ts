import { afterEach, describe, expect, test } from "bun:test";
import { appContentSecurityPolicy } from "./csp";

const S3_VARS = [
  "WEBFROST_STORAGE_BACKEND",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

afterEach(() => {
  for (const name of S3_VARS) process.env[name] = undefined;
});

function directive(csp: string, name: string): string {
  return csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

describe("appContentSecurityPolicy", () => {
  test("filesystem storage: everything is same-origin", () => {
    const csp = appContentSecurityPolicy();
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(directive(csp, "script-src")).toBe("script-src 'self'");
    expect(directive(csp, "img-src")).toBe("img-src 'self' data:");
    expect(directive(csp, "media-src")).toBe("media-src 'self'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  test("S3 storage: images and media may load from the presigned-URL origin, nothing else changes", () => {
    process.env.WEBFROST_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = "https://objects.example.net:9000";
    process.env.S3_BUCKET = "archive";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";

    const csp = appContentSecurityPolicy();

    expect(directive(csp, "img-src")).toMatch(
      /^img-src 'self' data: https:\/\/[a-z.]*objects\.example\.net:9000$/,
    );
    expect(directive(csp, "media-src")).toMatch(
      /^media-src 'self' https:\/\/[a-z.]*objects\.example\.net:9000$/,
    );
    // Scripts, connections and frames stay locked to this origin.
    expect(directive(csp, "script-src")).toBe("script-src 'self'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'self'");
  });

  test("a misconfigured S3 backend falls back to the same-origin policy", () => {
    process.env.WEBFROST_STORAGE_BACKEND = "s3";
    expect(directive(appContentSecurityPolicy(), "img-src")).toBe("img-src 'self' data:");
  });
});
