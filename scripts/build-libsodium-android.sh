#!/usr/bin/env bash
# build-libsodium-android.sh
#
# Pre-build libsodium as a static library for aarch64-linux-android.
#
# WHY THIS IS NEEDED
# ─────────────────────────────────────────────────────────────────────
# libsodium-sys-stable (pulled in by tauri-plugin-stronghold) uses an
# autoconf build to cross-compile libsodium for Android. On macOS the
# configure script can't find `aarch64-linux-android-ar` (the NDK only
# ships `llvm-ar`, not a target-prefixed wrapper), so it falls back to
# macOS `/usr/bin/ar`. That produces an empty 96-byte libsodium.a;
# cargo links it with --allow-undefined, and the app crashes on device:
#
#   UnsatisfiedLinkError: cannot locate symbol "sodium_memcmp"
#
# This script builds libsodium correctly (AR=llvm-ar) and installs it
# to .sodium-android-arm64/ in the workspace root. The path is then
# picked up via SODIUM_LIB_DIR in .cargo/config.toml.
#
# USAGE
# ─────────────────────────────────────────────────────────────────────
#   ./scripts/build-libsodium-android.sh             # auto-detect NDK
#   ./scripts/build-libsodium-android.sh --ndk /path/to/ndk
#
# Run once per machine. Re-run after `cargo clean` or when the
# libsodium-sys-stable version changes in Cargo.lock.

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[libsodium-build]${NC} $*"; }
warn()    { echo -e "${YELLOW}[libsodium-build]${NC} $*"; }
error()   { echo -e "${RED}[libsodium-build] ERROR:${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="$WORKSPACE/.sodium-android-arm64"
CONFIG_TOML="$WORKSPACE/.cargo/config.toml"

# ── Parse args ───────────────────────────────────────────────────────

NDK_HOME_OVERRIDE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --ndk) NDK_HOME_OVERRIDE="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,40p' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \?//'
            exit 0 ;;
        *) error "Unknown argument: $1" ;;
    esac
done

# ── Locate Android NDK ───────────────────────────────────────────────

find_ndk() {
    # Priority: --ndk arg → ANDROID_NDK_HOME → ANDROID_NDK_ROOT → sdk/ndk (newest)
    if [[ -n "$NDK_HOME_OVERRIDE" ]]; then
        echo "$NDK_HOME_OVERRIDE"; return
    fi
    if [[ -n "${ANDROID_NDK_HOME:-}" && -d "$ANDROID_NDK_HOME" ]]; then
        echo "$ANDROID_NDK_HOME"; return
    fi
    if [[ -n "${ANDROID_NDK_ROOT:-}" && -d "$ANDROID_NDK_ROOT" ]]; then
        echo "$ANDROID_NDK_ROOT"; return
    fi
    local sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    local ndk_dir="$sdk/ndk"
    if [[ -d "$ndk_dir" ]]; then
        # Pick the newest installed NDK
        local newest
        newest=$(ls -1 "$ndk_dir" | sort -V | tail -1)
        [[ -n "$newest" ]] && echo "$ndk_dir/$newest" && return
    fi
    return 1
}

NDK_PATH=$(find_ndk) || error \
    "Android NDK not found. Set ANDROID_NDK_HOME or pass --ndk /path/to/ndk."

TOOLCHAIN="$NDK_PATH/toolchains/llvm/prebuilt"
HOST_TAG=""
case "$(uname -s)-$(uname -m)" in
    Darwin-arm64|Darwin-x86_64) HOST_TAG="darwin-x86_64" ;;
    Linux-x86_64)               HOST_TAG="linux-x86_64"  ;;
    *) error "Unsupported host OS/arch: $(uname -s)-$(uname -m)" ;;
esac
TOOLCHAIN="$TOOLCHAIN/$HOST_TAG/bin"

[[ -f "$TOOLCHAIN/llvm-ar" ]]     || error "llvm-ar not found in NDK toolchain: $TOOLCHAIN"
[[ -f "$TOOLCHAIN/llvm-ranlib" ]] || error "llvm-ranlib not found"

# Pick a clang version — prefer API 24, fall back to whatever is available
CLANG=""
for api in 24 23 21; do
    candidate="$TOOLCHAIN/aarch64-linux-android${api}-clang"
    if [[ -f "$candidate" ]]; then CLANG="$candidate"; break; fi
done
[[ -n "$CLANG" ]] || error "No aarch64-linux-android*-clang found in $TOOLCHAIN"

info "NDK:       $NDK_PATH"
info "Clang:     $CLANG"
info "AR:        $TOOLCHAIN/llvm-ar"
info "Install:   $INSTALL_DIR"

# ── Locate or bootstrap libsodium source ─────────────────────────────

LIBSODIUM_VERSION="1.0.22"
LIBSODIUM_SRC=""

# 1. Check cargo build cache (fastest — no download needed)
CACHE_GLOB="$WORKSPACE/target/aarch64-linux-android/release/build/libsodium-sys-stable-*/out/source/libsodium-stable"
for d in $CACHE_GLOB; do
    if [[ -f "$d/configure" ]]; then
        LIBSODIUM_SRC="$d"
        info "Using cached source: $LIBSODIUM_SRC"
        break
    fi
done

# 2. Download if not cached
if [[ -z "$LIBSODIUM_SRC" ]]; then
    TARBALL_URL="https://download.libsodium.org/libsodium/releases/libsodium-${LIBSODIUM_VERSION}-stable.tar.gz"
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    info "Downloading libsodium ${LIBSODIUM_VERSION}-stable..."
    if command -v curl &>/dev/null; then
        curl -fsSL "$TARBALL_URL" -o "$TMP_DIR/libsodium.tar.gz"
    elif command -v wget &>/dev/null; then
        wget -q "$TARBALL_URL" -O "$TMP_DIR/libsodium.tar.gz"
    else
        error "curl or wget required to download libsodium"
    fi

    tar -xf "$TMP_DIR/libsodium.tar.gz" -C "$TMP_DIR"
    LIBSODIUM_SRC=$(find "$TMP_DIR" -maxdepth 2 -name configure -print -quit | xargs dirname)
    [[ -n "$LIBSODIUM_SRC" ]] || error "Failed to find configure in downloaded tarball"
    info "Downloaded and extracted to: $LIBSODIUM_SRC"
fi

# ── Build ─────────────────────────────────────────────────────────────

cd "$LIBSODIUM_SRC"

# Clean any previous (possibly broken) build
if [[ -f Makefile ]]; then
    info "Cleaning previous build..."
    make distclean 2>/dev/null || true
fi

info "Running configure..."
export CC="$CLANG"
export CXX="${CLANG/clang/clang++}"
export AR="$TOOLCHAIN/llvm-ar"
export RANLIB="$TOOLCHAIN/llvm-ranlib"
export STRIP="$TOOLCHAIN/llvm-strip"
export NM="$TOOLCHAIN/llvm-nm"

./configure \
    --host=aarch64-linux-android \
    --prefix="$INSTALL_DIR" \
    --disable-shared \
    --enable-static \
    --with-pic \
    --quiet

NPROC=$(sysctl -n hw.logicalcpu 2>/dev/null || nproc 2>/dev/null || echo 4)
info "Building with $NPROC cores..."
make -j"$NPROC"

info "Installing to $INSTALL_DIR..."
make install

# ── Verify ───────────────────────────────────────────────────────────

LIBSODIUM_A="$INSTALL_DIR/lib/libsodium.a"
[[ -f "$LIBSODIUM_A" ]] || error "libsodium.a not found after install"
SIZE=$(wc -c < "$LIBSODIUM_A")
if (( SIZE < 100000 )); then
    error "libsodium.a looks too small ($SIZE bytes) — build may have failed"
fi
info "libsodium.a: $(du -h "$LIBSODIUM_A" | cut -f1) ✓"

# ── Update .cargo/config.toml ─────────────────────────────────────────

update_cargo_config() {
    local cfg="$CONFIG_TOML"
    local new_path="$INSTALL_DIR/lib"

    if [[ ! -f "$cfg" ]]; then
        warn ".cargo/config.toml not found — skipping automatic update"
        return
    fi

    # Replace the SODIUM_LIB_DIR line (handles both quoted styles)
    if grep -q "SODIUM_LIB_DIR" "$cfg"; then
        sed -i.bak \
            "s|SODIUM_LIB_DIR = \"[^\"]*\"|SODIUM_LIB_DIR = \"$new_path\"|g" \
            "$cfg"
        rm -f "$cfg.bak"
        info "Updated SODIUM_LIB_DIR in .cargo/config.toml → $new_path"
    else
        warn "SODIUM_LIB_DIR not found in .cargo/config.toml — please add manually:"
        warn "  SODIUM_LIB_DIR = \"$new_path\""
    fi
}

update_cargo_config

# ── Done ──────────────────────────────────────────────────────────────

echo ""
info "Done! Now clear the cargo cache and rebuild:"
echo ""
echo "  rm -rf target/aarch64-linux-android/release/build/libsodium-sys-stable-*"
echo "  rm -rf target/aarch64-linux-android/release/.fingerprint/libsodium-sys-stable-*"
echo "  rm -f  target/aarch64-linux-android/release/libsendme_app.so"
echo ""
echo "  cd app"
echo "  export ANDROID_NDK_HOME='$NDK_PATH'"
echo "  pnpm run tauri android build --target aarch64"
