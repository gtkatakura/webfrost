/** The scripts the release workflow runs: formula generation and release notes. */
import { describe, expect, test } from "bun:test";
import { formula, parseChecksums } from "../../../scripts/homebrew-formula";
import { sectionFor } from "../../../scripts/release-notes";

const HASH = (n: string) => n.repeat(64).slice(0, 64);
const CHECKSUMS = [
  `${HASH("a")}  webfrost-darwin-arm64.tar.gz`,
  `${HASH("b")}  webfrost-darwin-x64.tar.gz`,
  `${HASH("c")}  webfrost-linux-arm64.tar.gz`,
  `${HASH("d")}  webfrost-linux-x64.tar.gz`,
  `${HASH("e")}  webfrost-windows-x64.zip`,
].join("\n");

describe("homebrew formula", () => {
  test("has a url and sha256 per OS and CPU, and installs the binary", () => {
    const rb = formula("1.2.3", parseChecksums(CHECKSUMS), "o/r");
    expect(rb).toContain('version "1.2.3"');
    expect(rb).toContain(
      `releases/download/v1.2.3/webfrost-darwin-arm64.tar.gz"\n      sha256 "${HASH("a")}"`,
    );
    expect(rb).toContain(`webfrost-linux-x64.tar.gz"\n      sha256 "${HASH("d")}"`);
    expect(rb).toContain("on_macos do");
    expect(rb).toContain("on_linux do");
    expect(rb).toContain("on_arm do");
    expect(rb).toContain("on_intel do");
    expect(rb).toContain('bin.install "webfrost"');
    expect(rb).toContain('shell_output("#{bin}/webfrost --version")');
    expect(rb).toContain("webfrost setup");
  });

  test("a missing archive is an error, not an empty hash", () => {
    const partial = parseChecksums(CHECKSUMS.split("\n").slice(0, 3).join("\n"));
    expect(() => formula("1.2.3", partial)).toThrow("webfrost-linux-x64.tar.gz");
  });
});

describe("release notes", () => {
  const changelog =
    "# Changelog\n\n## [Unreleased]\n\nnext\n\n## [0.2.0] - 2027-01-01\n\nnew\n\n## 0.1.0\n\nfirst\n";

  test("finds a section by version in either heading style", () => {
    expect(sectionFor(changelog, "0.2.0")).toBe("new");
    expect(sectionFor(changelog, "0.1.0")).toBe("first");
  });

  test("returns null when there is no section", () => {
    expect(sectionFor(changelog, "9.9.9")).toBeNull();
  });
});
