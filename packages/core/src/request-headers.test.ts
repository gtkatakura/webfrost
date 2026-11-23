import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BROWSER_USER_AGENT, CHROME_MAJOR_VERSION } from "./request-headers";

describe("browser request headers", () => {
  test("the Chrome version is the one of the Chromium Playwright ships", () => {
    // playwright-core is Playwright's own dependency, and browsers.json is not among its exports.
    const fromPlaywright = createRequire(require.resolve("playwright"));
    const coreDir = dirname(fromPlaywright.resolve("playwright-core/package.json"));
    const { browsers } = JSON.parse(readFileSync(join(coreDir, "browsers.json"), "utf8")) as {
      browsers: { name: string; browserVersion: string }[];
    };
    const chromium = browsers.find((b) => b.name === "chromium");
    expect(Number(chromium?.browserVersion.split(".")[0])).toBe(CHROME_MAJOR_VERSION);
  });

  test("the user agent reads as desktop Chrome, not as a headless or scripted client", () => {
    expect(BROWSER_USER_AGENT).toMatch(/^Mozilla\/5\.0 .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(BROWSER_USER_AGENT).not.toMatch(/headless|bun|node/i);
  });
});
