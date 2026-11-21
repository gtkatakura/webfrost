/**
 * Print the release notes for a version, from the changelogs.
 *
 *   bun scripts/release-notes.ts 1.2.3 > notes.md
 *
 * Looks for a `## 1.2.3` or `## [1.2.3]` section in CHANGELOG.md, then in the CLI
 * package's changelog (written by `changeset version`). Prints nothing and exits 1 when
 * neither has one, so the caller can fall back to generated notes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

/** The body of the `## <version>` section of a changelog, or null. */
export function sectionFor(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const heading = (line: string) => /^## /.test(line);
  const matches = (line: string) => {
    const title = line.replace(/^##\s+/, "").trim();
    return (
      title === version ||
      title.startsWith(`${version} `) ||
      title.startsWith(`[${version}]`) ||
      title.endsWith(`(${version})`)
    );
  };
  const start = lines.findIndex((l) => heading(l) && matches(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && heading(l));
  if (end === -1) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body === "" ? null : body;
}

if (import.meta.main) {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version) {
    console.error("usage: bun scripts/release-notes.ts <version>");
    process.exit(2);
  }
  for (const file of [join(root, "CHANGELOG.md"), join(root, "packages/cli/CHANGELOG.md")]) {
    if (!existsSync(file)) continue;
    const notes = sectionFor(readFileSync(file, "utf8"), version);
    if (notes) {
      console.log(notes);
      process.exit(0);
    }
  }
  process.exit(1);
}
