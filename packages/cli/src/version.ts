import pkg from "../package.json";

// Replaced at build time by `bun run build:binary` (--define) so a release binary reports
// the version of its tag; otherwise the version in package.json.
declare const __WEBFROST_VERSION__: string | undefined;

export const VERSION: string =
  typeof __WEBFROST_VERSION__ === "string" && __WEBFROST_VERSION__ !== ""
    ? __WEBFROST_VERSION__
    : pkg.version;
