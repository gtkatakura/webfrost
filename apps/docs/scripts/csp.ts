// Runs after `react-router build` (the `build` script): writes build/csp.json, the Content-Security-Policy of
// every page in build/client, keyed by its path there ("/docs/quick-start/index.html"). src/main.ts sends it
// with the page, so nothing is hashed while serving.
import { glob } from "node:fs/promises";
import { join } from "node:path";
import { contentSecurityPolicy } from "../src/csp";

const build = join(import.meta.dir, "../build");
const policies: Record<string, string> = {};
for await (const path of glob("**/*.html", { cwd: join(build, "client") })) {
  policies[`/${path}`] = contentSecurityPolicy(await Bun.file(join(build, "client", path)).text());
}
await Bun.write(join(build, "csp.json"), `${JSON.stringify(policies, null, 2)}\n`);
console.log(`csp: ${Object.keys(policies).length} pages -> build/csp.json`);
