/**
 * Package the binaries built by build-binary.ts for a GitHub release.
 *
 *   bun run packages/cli/scripts/package-release.ts --outdir <build dir> --release-dir <dir>
 *
 * For every <outdir>/<target>/webfrost[.exe] it writes webfrost-<target>.tar.gz (zip for
 * Windows) containing the binary and the LICENSE, then checksums.txt with one
 * "<sha256>  <file>" line per archive. install.sh and the Homebrew formula
 * all rely on these names.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { TARGETS } from "./build-binary";

const root = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const outdir = resolve(arg("outdir") ?? join(import.meta.dir, "../dist-binary"));
const releaseDir = resolve(arg("release-dir") ?? join(outdir, "release"));
mkdirSync(releaseDir, { recursive: true });

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

const lines: string[] = [];
for (const target of TARGETS) {
  const dir = join(outdir, target);
  const exe = target.startsWith("windows") ? "webfrost.exe" : "webfrost";
  if (!existsSync(join(dir, exe))) continue;
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  const archive = target.startsWith("windows")
    ? `webfrost-${target}.zip`
    : `webfrost-${target}.tar.gz`;
  const archivePath = join(releaseDir, archive);
  if (archive.endsWith(".zip")) await run(["zip", "-q", "-j", archivePath, exe, "LICENSE"], dir);
  else await run(["tar", "-czf", archivePath, "-C", dir, exe, "LICENSE"], dir);
  const hash = new Bun.CryptoHasher("sha256").update(readFileSync(archivePath)).digest("hex");
  lines.push(`${hash}  ${archive}`);
  console.log(`${archive}  ${hash}`);
}
if (lines.length === 0) throw new Error(`No binaries found under ${outdir}`);
writeFileSync(join(releaseDir, "checksums.txt"), `${lines.join("\n")}\n`);
console.log(`Wrote ${readdirSync(releaseDir).length} files to ${releaseDir}`);
