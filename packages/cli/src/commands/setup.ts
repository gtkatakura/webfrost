import { existsSync } from "node:fs";
import { resolveChromium, webfrostBrowsersDir } from "@webfrost/core";
import {
  browserPackagesHint,
  chromiumLaunches,
  chromiumVersion,
  installChromium,
  missingLibraries,
} from "../chromium-install";
import type { Command } from "../cli";
import { CliError } from "../errors";

const SOURCE_LABEL = {
  env: "WEBFROST_CHROMIUM_PATH",
  cache: "installed by webfrost setup",
  system: "found on this system",
  playwright: "Playwright's own browser cache",
} as const;

export const setupCommand: Command = {
  kind: "command",
  name: "setup",
  summary: "Install a headless Chromium, unless a usable one is found",
  description:
    "Look for a Chromium or Chrome and, if there is none, download Playwright's headless Chromium into WebFrost's cache directory. WebFrost needs a browser for the screenshot, PDF, DOM and SingleFile extractors.",
  options: {
    force: {
      type: "boolean",
      description: "Download Chromium even when a usable browser is already found",
    },
  },
  notes: `
Where WebFrost looks for a browser, first match wins:
  1. WEBFROST_CHROMIUM_PATH
  2. the Chromium this command installs, in the cache directory
     (~/.cache/webfrost, ~/Library/Caches/webfrost, %LOCALAPPDATA%\\webfrost;
     override with WEBFROST_CACHE_DIR)
  3. a system Chrome or Chromium (/Applications/Google Chrome.app, /usr/bin/chromium,
     chromium-browser, google-chrome, Program Files\\Google\\Chrome ...)
  4. Playwright's own browser cache

On Linux the downloaded browser needs system libraries (nss, atk, gbm ...). If it does not
start, install them with your package manager, or install Chromium itself.`,
  examples: ["webfrost setup", "WEBFROST_CHROMIUM_PATH=/usr/bin/chromium webfrost setup"],
  async run(ctx) {
    const found = resolveChromium();
    if (found.source === "env" && found.path && !existsSync(found.path)) {
      throw new CliError(
        `WEBFROST_CHROMIUM_PATH points at ${found.path}, which does not exist. Fix or unset it.`,
      );
    }
    if (found.path && !ctx.bool("force")) {
      const check = await chromiumVersion(found.path);
      if (check.ok) {
        ctx.logger.info(
          `Chromium found (${SOURCE_LABEL[found.source]}): ${found.path} (${check.version}). Nothing to install.`,
        );
        return 0;
      }
      if (found.source === "env") {
        throw new CliError(`${found.path} does not start: ${check.reason}`);
      }
      ctx.logger.warn(`${found.path} does not start (${check.reason}); installing Chromium.`);
    }

    ctx.logger.info(`Installing Chromium (headless shell) into ${webfrostBrowsersDir()}`);
    let lastPercent = -1;
    const interactive = Boolean(process.stderr.isTTY) && !ctx.quiet;
    let path: string;
    try {
      path = await installChromium({
        log: (m) => ctx.logger.info(m),
        progress: (done, total) => {
          if (!interactive || total <= 0) return;
          const percent = Math.floor((done / total) * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          process.stderr.write(`\r  ${percent}% of ${(total / 1e6).toFixed(0)} MB`);
          if (percent === 100) process.stderr.write("\n");
        },
      });
    } catch (err) {
      throw new CliError(
        `Could not install Chromium: ${err instanceof Error ? err.message : String(err)}\nInstall Chrome or Chromium yourself and set WEBFROST_CHROMIUM_PATH.`,
      );
    }
    const check = await chromiumVersion(path);
    if (!check.ok) {
      throw new CliError(
        `Chromium was installed at ${path} but does not start: ${check.reason}\n${
          missingLibraries(check.reason).length
            ? `Install what it needs:\n  ${browserPackagesHint()}\nthen run \`webfrost setup\` again.`
            : "On Linux it needs system libraries (nss, atk, gbm...). Install them, or install Chromium from your package manager."
        }`,
      );
    }
    const launch = await chromiumLaunches(path);
    if (!launch.ok) {
      throw new CliError(
        `Chromium was installed at ${path} but cannot open a page: ${launch.reason}\nInstall what it needs:\n  ${browserPackagesHint()}\nthen run \`webfrost doctor\`.`,
      );
    }
    ctx.logger.info(`Chromium ready: ${path} (${check.version})`);
    return 0;
  },
};
