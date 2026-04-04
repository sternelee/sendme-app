#!/usr/bin/env bash
# Install sendme CLI tool
# Usage: curl -sSL https://raw.githubusercontent.com/sternelee/sendme-app/main/install.sh | bash
#   or: curl -sSL https://raw.githubusercontent.com/sternelee/sendme-app/main/install.sh | bash -s -- --prefix ~/.local

set -e

REPO="sternelee/sendme-app"
PREFIX="${PREFIX:-/usr/local}"
BIN_DIR="${PREFIX}/bin"
INSTALL_DIR="${PREFIX}/sendme"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --prefix)
            PREFIX="$2"
            BIN_DIR="${PREFIX}/bin"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [--prefix <dir>]"
            echo ""
            echo "Options:"
            echo "  --prefix <dir>    Install prefix (default: /usr/local)"
            echo "                    Binaries go to <prefix>/bin"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Detect OS and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
    x86_64)
        ARCH="x86_64"
        ;;
    aarch64|arm64)
        ARCH="aarch64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

case "$OS" in
    darwin*)
        OS="apple-darwin"
        ;;
    linux*)
        OS="unknown-linux-gnu"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

TARGET="${ARCH}-${OS}"

# Get latest release version
VERSION=$(curl -sSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "Failed to fetch latest release version"
    exit 1
fi

echo "Installing sendme ${VERSION} for ${TARGET}..."

# Create directories
mkdir -p "${BIN_DIR}"
mkdir -p "${INSTALL_DIR}"

# Download and extract
TAR_NAME="sendme-cli-${VERSION}-${TARGET}.tar.gz"
TMP_DIR=$(mktemp -d)

curl -sSL "https://github.com/${REPO}/releases/download/v${VERSION}/${TAR_NAME}" -o "${TMP_DIR}/${TAR_NAME}"

if [ ! -f "${TMP_DIR}/${TAR_NAME}" ]; then
    echo "Failed to download release"
    exit 1
fi

tar -xzf "${TMP_DIR}/${TAR_NAME}" -C "${TMP_DIR}"

# Install binary
cp "${TMP_DIR}/sendme" "${BIN_DIR}/sendme"
chmod +x "${BIN_DIR}/sendme"

# Cleanup
rm -rf "${TMP_DIR}"

echo ""
echo "Installed sendme to ${BIN_DIR}/sendme"
echo ""

# Verify installation
"${BIN_DIR}/sendme" --version || true
