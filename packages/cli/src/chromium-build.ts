// Runs at bundle time (imported with `with { type: "macro" }`), so the compiled binary carries the
// Chrome version the bundled Playwright expects, without reading Playwright's files at run time.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The Chrome for Testing version of the headless shell that this Playwright release drives. */
export function headlessShellVersion(): string {
  const require = createRequire(import.meta.url);
  // playwright-core exports package.json but not browsers.json; both sit in the package root.
  const root = dirname(require.resolve("playwright-core/package.json"));
  const browsers = JSON.parse(readFileSync(join(root, "browsers.json"), "utf8")) as {
    browsers: { name: string; browserVersion?: string }[];
  };
  const shell = browsers.browsers.find((b) => b.name === "chromium-headless-shell");
  if (!shell?.browserVersion)
    throw new Error("playwright-core lists no chromium-headless-shell version");
  return shell.browserVersion;
}
