/**
 * Build the single-file `webfrost` executable with `bun build --compile`.
 *
 *   bun run build:binary                            # host platform
 *   bun run build:binary -- --target linux-x64      # one target
 *   bun run build:binary -- --target all            # the five release targets
 *   bun run build:binary -- --version 1.2.3         # the version `webfrost --version` reports
 *   bun run build:binary -- --outdir /tmp/out
 *
 * Output: <outdir>/<target>/webfrost (webfrost.exe on Windows). Bun cross-compiles, so
 * every target can be built from one machine (it downloads the target's runtime once).
 *
 * What the plain bundler does not handle, and the plugins here fix:
 * - packages/ui/dist is embedded: the stub packages/cli/src/ui-assets.ts is replaced by a
 *   module that imports every UI file with `type: "file"`.
 * - jsdom reads default-stylesheet.css from disk at load time: the file is inlined.
 * - css-tree (a jsdom dependency) loads its data files with createRequire(import.meta.url),
 *   which a bundle cannot resolve: its CommonJS build, which uses plain require(), is used.
 * - Playwright's optional electron and chromium-bidi modules are not installed and not
 *   needed for Chromium: they are left external.
 */
import { readdirSync } from "node:fs";
import { chmodSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";

const root = resolve(import.meta.dir, "../../..");
const cliDir = resolve(import.meta.dir, "..");
const uiDist = join(root, "packages/ui/dist");

export const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
] as const;
export type Target = (typeof TARGETS)[number];

function hostTarget(): Target {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = `${os}-${arch}`;
  if (!(TARGETS as readonly string[]).includes(target)) {
    throw new Error(`No binary target for ${process.platform}/${process.arch}`);
  }
  return target as Target;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** The module that replaces src/ui-assets.ts in the binary. */
function embeddedUiSource(): string {
  const files = [...walk(uiDist)].sort();
  if (files.length === 0) throw new Error(`${uiDist} is empty: build the UI first (bun run build)`);
  const imports = files.map(
    (f, i) => `import f${i} from ${JSON.stringify(f)} with { type: "file" };`,
  );
  const entries = files.map(
    (f, i) => `  ${JSON.stringify(`/${relative(uiDist, f).split("\\").join("/")}`)}: f${i},`,
  );
  return `${imports.join("\n")}\nexport const embeddedUi: Record<string, string> | null = {\n${entries.join("\n")}\n};\n`;
}

const embedUiPlugin: BunPlugin = {
  name: "embed-ui",
  setup(build) {
    build.onLoad({ filter: /packages[\\/]cli[\\/]src[\\/]ui-assets\.ts$/ }, () => ({
      contents: embeddedUiSource(),
      loader: "ts",
    }));
  },
};

const bundleFixesPlugin: BunPlugin = {
  name: "bundle-fixes",
  setup(build) {
    // css-tree: ESM build -> CommonJS build (see the header comment).
    build.onResolve({ filter: /^css-tree$/ }, (args) => {
      const pkg = Bun.resolveSync("css-tree/package.json", dirname(args.importer));
      return { path: join(dirname(pkg), "cjs", "index.cjs") };
    });

    // jsdom: inline the default stylesheet it reads from disk when loaded.
    build.onLoad(
      { filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]css[\\/]helpers[\\/]computed-style\.js$/ },
      async (args) => {
        const source = await Bun.file(args.path).text();
        const pattern =
          /fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\)\s*,\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\)/;
        if (!pattern.test(source)) {
          throw new Error(
            "jsdom changed: computed-style.js no longer reads default-stylesheet.css the expected way",
          );
        }
        const css = await Bun.file(
          join(dirname(args.path), "../../../browser/default-stylesheet.css"),
        ).text();
        return { contents: source.replace(pattern, JSON.stringify(css)), loader: "js" };
      },
    );
  },
};

export async function buildBinary(options: {
  target: Target;
  outdir: string;
  version?: string | undefined;
}): Promise<string> {
  const { target, outdir, version } = options;
  const exe = target.startsWith("windows") ? "webfrost.exe" : "webfrost";
  const outfile = join(outdir, target, exe);
  rmSync(join(outdir, target), { recursive: true, force: true });
  mkdirSync(join(outdir, target), { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(cliDir, "src/index.ts")],
    compile: { target: `bun-${target}` as `bun-${string}`, outfile },
    minify: true,
    target: "bun",
    external: ["electron", "chromium-bidi/*"],
    plugins: [embedUiPlugin, bundleFixesPlugin],
    define: version ? { __WEBFROST_VERSION__: JSON.stringify(version) } : {},
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    throw new Error(`Build failed for ${target}`);
  }
  if (!target.startsWith("windows")) chmodSync(outfile, 0o755);
  return outfile;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const targetArg = arg("target") ?? hostTarget();
  const targets: Target[] =
    targetArg === "all"
      ? [...TARGETS]
      : targetArg.split(",").map((t) => {
          if (!(TARGETS as readonly string[]).includes(t)) {
            throw new Error(`Unknown target "${t}". Use: ${TARGETS.join(", ")}, all`);
          }
          return t as Target;
        });
  const outdir = resolve(arg("outdir") ?? join(cliDir, "dist-binary"));
  const version = arg("version")?.replace(/^v/, "");

  for (const target of targets) {
    const started = Date.now();
    const file = await buildBinary({ target, outdir, version });
    const mb = (statSync(file).size / 1024 / 1024).toFixed(1);
    console.log(`${target}: ${file} (${mb} MB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}
