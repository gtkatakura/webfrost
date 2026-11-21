#!/bin/sh
# WebFrost installer for macOS and Linux:
#
#   curl -fsSL https://webfrost.dev/install.sh | sh
#
# It downloads the `webfrost` binary for this machine from the latest GitHub release,
# checks its SHA-256 against the release's checksums.txt (and stops if it does not
# match), and puts it in ~/.local/bin. It never uses sudo. On Windows, use install.ps1.
#
# Environment:
#   WEBFROST_VERSION        version to install, for example 1.2.3 (default: the latest release)
#   WEBFROST_INSTALL_DIR    where to put the binary (default: $HOME/.local/bin)
#   WEBFROST_DOWNLOAD_BASE  URL that holds the archives and checksums.txt, instead of the
#                           GitHub release. For testing and for mirrors.

set -eu

REPO="gtkatakura/webfrost"

say() { printf '%s\n' "$*"; }
err() { printf 'install.sh: error: %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

usage() {
  cat <<'EOF'
Install the webfrost binary.

Usage: curl -fsSL https://webfrost.dev/install.sh | sh
       sh install.sh [--help]

Environment:
  WEBFROST_VERSION        version to install, for example 1.2.3 (default: latest)
  WEBFROST_INSTALL_DIR    install directory (default: $HOME/.local/bin)
  WEBFROST_DOWNLOAD_BASE  URL holding the archives and checksums.txt (testing, mirrors)
EOF
}

case "${1-}" in
  -h | --help) usage; exit 0 ;;
  "") ;;
  *) err "unknown argument: $1"; usage >&2; exit 2 ;;
esac

# ── What are we installing on? ───────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    MINGW* | MSYS* | CYGWIN*)
      die "this is Windows: use the PowerShell installer instead: irm https://webfrost.dev/install.ps1 | iex" ;;
    *) die "unsupported operating system: $(uname -s). WebFrost has binaries for macOS, Linux and Windows." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m). WebFrost has binaries for x64 and arm64." ;;
  esac
  # A shell started under Rosetta reports x86_64 on an Apple Silicon Mac: install the native build.
  if [ "$1" = darwin ] && [ "$arch" = x64 ] &&
    [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  echo "$arch"
}

OS=$(detect_os)
ARCH=$(detect_arch "$OS")

if [ "$OS" = linux ]; then
  # The Linux binaries are built for glibc. Alpine and other musl systems cannot run them.
  if ls /lib/ld-musl-* /usr/lib/ld-musl-* >/dev/null 2>&1; then
    die "this Linux uses musl libc (Alpine?), which the WebFrost binary does not support. Use the Docker image: docker run ghcr.io/$REPO/server"
  fi
fi

# ── Where to download from ───────────────────────────────────────────────────────

ARCHIVE="webfrost-$OS-$ARCH.tar.gz"

if [ -n "${WEBFROST_DOWNLOAD_BASE-}" ]; then
  BASE=${WEBFROST_DOWNLOAD_BASE%/}
elif [ -n "${WEBFROST_VERSION-}" ]; then
  VERSION=${WEBFROST_VERSION#v}
  BASE="https://github.com/$REPO/releases/download/v$VERSION"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

INSTALL_DIR=${WEBFROST_INSTALL_DIR:-${HOME:?HOME is not set; set WEBFROST_INSTALL_DIR}/.local/bin}

# ── Tools ────────────────────────────────────────────────────────────────────────

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "neither curl nor wget is installed; install one of them and run this again"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "neither sha256sum nor shasum is installed, so the download cannot be verified; install coreutils (or perl's shasum) and run this again"
fi

command -v tar >/dev/null 2>&1 || die "tar is not installed"

# ── Download, verify, install ────────────────────────────────────────────────────

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t webfrost) || die "cannot create a temporary directory"
trap 'rm -rf "$TMP"' EXIT INT TERM HUP

say "Installing webfrost ($OS-$ARCH) from $BASE"

fetch "$BASE/$ARCHIVE" "$TMP/$ARCHIVE" ||
  die "cannot download $BASE/$ARCHIVE (is there a release${WEBFROST_VERSION:+ $WEBFROST_VERSION} for $OS-$ARCH?)"
fetch "$BASE/checksums.txt" "$TMP/checksums.txt" ||
  die "cannot download $BASE/checksums.txt, so the download cannot be verified"

# checksums.txt lines look like: <sha256>  <file name>
EXPECTED=$(awk -v f="$ARCHIVE" '$2 == f || $2 == "*" f { print $1; exit }' "$TMP/checksums.txt")
[ -n "$EXPECTED" ] || die "checksums.txt has no entry for $ARCHIVE"
ACTUAL=$(sha256 "$TMP/$ARCHIVE")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  err "checksum mismatch for $ARCHIVE"
  err "  expected: $EXPECTED"
  err "  actual:   $ACTUAL"
  die "the download is corrupt or has been tampered with; nothing was installed"
fi
say "Checksum verified (sha256 $ACTUAL)"

mkdir "$TMP/extract"
tar -xzf "$TMP/$ARCHIVE" -C "$TMP/extract" || die "cannot unpack $ARCHIVE"
[ -f "$TMP/extract/webfrost" ] || die "$ARCHIVE does not contain a webfrost binary"

mkdir -p "$INSTALL_DIR" || die "cannot create $INSTALL_DIR (set WEBFROST_INSTALL_DIR to a directory you can write to)"
[ -w "$INSTALL_DIR" ] || die "$INSTALL_DIR is not writable (set WEBFROST_INSTALL_DIR to a directory you can write to)"
# Copy next to the destination, then rename: replacing a running binary is safe that way.
cp "$TMP/extract/webfrost" "$INSTALL_DIR/.webfrost.$$" || die "cannot write to $INSTALL_DIR"
chmod 755 "$INSTALL_DIR/.webfrost.$$"
mv -f "$INSTALL_DIR/.webfrost.$$" "$INSTALL_DIR/webfrost" || die "cannot install into $INSTALL_DIR"

VERSION_OUT=$("$INSTALL_DIR/webfrost" --version 2>&1) ||
  die "the installed binary does not run: $VERSION_OUT"
say "Installed $VERSION_OUT to $INSTALL_DIR/webfrost"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    say ""
    say "$INSTALL_DIR is not on your PATH. Add it, for example:"
    say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.profile   # then open a new shell"
    ;;
esac

say ""
say "Next:"
say "  webfrost setup     # a headless Chromium, if you have none"
say "  webfrost serve     # server, web UI and scheduler on :3000"
