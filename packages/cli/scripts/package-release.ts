/**
 * Package the binaries built by build-binary.ts for a GitHub release.
 *
 *   bun run packages/cli/scripts/package-release.ts --outdir <build dir> --release-dir <dir>
 *
 * For every <outdir>/<target>/webfrost[.exe] it writes webfrost-<target>.tar.gz (zip for
 * Windows) containing the binary and the LICENSE; for Linux also a .deb and an .rpm (nfpm, which
 * mise installs), whose dependencies bring the system libraries Chromium needs. Then checksums.txt
 * with one "<sha256>  <file>" line per file. install.sh and the Homebrew formula rely on these names.
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

// ── Linux packages ──────────────────────────────────────────────────────────────────────────
// The browser's libraries are dependencies, so `apt install ./webfrost_*.deb` (or dnf) brings
// everything `webfrost setup`'s Chromium needs. Debian 13 and Ubuntu 24.04 renamed some of them with
// "t64": each such dependency accepts either name. yt-dlp and ffmpeg (video) are recommended only.
const version = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
const DEB_DEPENDS = [
  "ca-certificates",
  "libglib2.0-0t64 | libglib2.0-0",
  "libnss3",
  "libnspr4",
  "libatk1.0-0t64 | libatk1.0-0",
  "libatk-bridge2.0-0t64 | libatk-bridge2.0-0",
  "libcups2t64 | libcups2",
  "libxkbcommon0",
  "libxcomposite1",
  "libxdamage1",
  "libxfixes3",
  "libxrandr2",
  "libgbm1",
  "libpango-1.0-0",
  "libcairo2",
  "libasound2t64 | libasound2",
  "libdbus-1-3",
];
const RPM_DEPENDS = [
  "ca-certificates",
  "glib2",
  "nss",
  "nspr",
  "atk",
  "at-spi2-atk",
  "cups-libs",
  "libxkbcommon",
  "libXcomposite",
  "libXdamage",
  "libXfixes",
  "libXrandr",
  "mesa-libgbm",
  "pango",
  "cairo",
  "alsa-lib",
  "dbus-libs",
];
const ARCH = { "linux-x64": "amd64", "linux-arm64": "arm64" } as const;
const yamlList = (items: string[]) => items.map((i) => `      - "${i}"`).join("\n");

for (const [target, arch] of Object.entries(ARCH)) {
  const binary = join(outdir, target, "webfrost");
  if (!existsSync(binary)) continue;
  const config = join(outdir, target, "nfpm.yaml");
  writeFileSync(
    config,
    `name: webfrost
arch: ${arch}
platform: linux
version: ${version}
version_schema: semver
section: web
priority: optional
maintainer: "gtkatakura <gtkatakura@users.noreply.github.com>"
description: |
  Self-hosted web archiver: WARC, PDF, screenshot, readable text, a self-contained HTML file and
  video from one visit. CLI, HTTP API and web UI in one binary.
vendor: WebFrost
homepage: https://webfrost.dev
license: MIT
contents:
  - src: ${binary}
    dst: /usr/bin/webfrost
    file_info:
      mode: 0755
  - src: ${join(root, "LICENSE")}
    dst: /usr/share/doc/webfrost/copyright
overrides:
  deb:
    depends:
${yamlList(DEB_DEPENDS)}
    recommends:
      - "fonts-liberation"
      - "yt-dlp"
      - "ffmpeg"
  rpm:
    depends:
${yamlList(RPM_DEPENDS)}
    recommends:
      - "liberation-fonts"
      - "yt-dlp"
      - "ffmpeg"
`,
  );
  for (const packager of ["deb", "rpm"] as const) {
    const before = new Set(readdirSync(releaseDir));
    await run(
      ["nfpm", "pkg", "--config", config, "--packager", packager, "--target", releaseDir],
      root,
    );
    const made = readdirSync(releaseDir).find((f) => !before.has(f));
    if (!made) throw new Error(`nfpm wrote no ${packager} for ${target}`);
    const hash = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(releaseDir, made)))
      .digest("hex");
    lines.push(`${hash}  ${made}`);
    console.log(`${made}  ${hash}`);
  }
}
writeFileSync(join(releaseDir, "checksums.txt"), `${lines.join("\n")}\n`);
console.log(`Wrote ${readdirSync(releaseDir).length} files to ${releaseDir}`);
