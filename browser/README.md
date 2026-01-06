# Sendme Browser

Browser WebAssembly bindings for sendme file transfer.

## Status

✅ **Functional - Requires special build configuration**

This crate provides WASM bindings for sendme to run in browsers. The browser crate is **excluded from the workspace** because it requires WASM-specific dependency configuration that conflicts with native builds.

## Important: Build Configuration

The browser crate has its own `[workspace]` section in `Cargo.toml` to exclude it from the parent workspace. This prevents WASM-incompatible dependencies (like `mio`) from being pulled in.

When building, **always** use:
```bash
# From the repository root
cargo build --target=wasm32-unknown-unknown --manifest-path=browser/Cargo.toml

# Or from the browser directory
cd browser
cargo build --target=wasm32-unknown-unknown
```

Do NOT use `cargo build -p sendme-browser` from the root - this will pull in workspace dependencies.

## Prerequisites

### Required Tools

```bash
# Install wasm32 target
rustup target install wasm32-unknown-unknown

# Install wasm-bindgen CLI (version must match Cargo.toml)
cargo install wasm-bindgen-cli --version 0.2.105

# Install Node.js dependencies
bun install
```

### Platform-Specific Requirements

#### macOS

**Critical**: Apple Clang does NOT support `wasm32-unknown-unknown`. You must use llvm.org Clang:

```bash
# Install llvm.org Clang via homebrew
brew install llvm

# Set CC environment variable
export CC=/opt/homebrew/opt/llvm/bin/clang
```

#### Windows

Building for WASM on Windows has limited support. Consider using:
- WSL (Windows Subsystem for Linux)
- Docker
- GitHub Actions (linux runners)

#### NixOS

Install 32-bit clang:
```bash
nix shell nixpkgs#clang_multi
cargo build --target=wasm32-unknown-unknown
```

### Common Issues

#### 1. Ring crate build failure

**Error**:
```
error: unable to create target: 'No available targets are compatible with triple "wasm32-unknown-unknown"'
```

**Cause**: Apple Clang doesn't support wasm32

**Fix**: Use llvm.org Clang (see macOS requirements above)

#### 2. mio dependency errors

**Error**: `error: could not compile 'mio'` when building for WASM

**Cause**: `mio` crate doesn't support WASM, and gets pulled in by workspace dependencies

**Fix**: The browser crate has its own `[workspace]` section to exclude it from the parent workspace. Always build using `--manifest-path=browser/Cargo.toml` or from the browser directory.

#### 3. wasm-bindgen version mismatch

**Error**:
```
rust Wasm file schema version: 0.2.105
   this binary schema version: 0.2.106
```

**Fix**: Ensure wasm-bindgen-cli version matches Cargo.toml (currently 0.2.105)

## Build Commands

```bash
# Set CC environment variable (macOS only, for llvm.org Clang)
export CC=/opt/homebrew/opt/llvm/bin/clang

# Build WASM
cargo build --target=wasm32-unknown-unknown

# Generate JavaScript bindings
wasm-bindgen target/wasm32-unknown-unknown/debug/sendme_browser.wasm \
  --out-dir=public/wasm --weak-refs --target=web --debug

# Or use npm scripts (recommended)
bun run build
bun run build:release
bun run serve
```

Then open [`http://localhost:8080`](http://localhost:8080)

## Testing with Official Examples

To verify your environment works, test with official iroh examples first:

```bash
git clone https://github.com/n0-computer/iroh-examples.git
cd iroh-examples/browser-blobs
npm install
npm run build
npm run serve
```

## Known Limitations

1. **In-memory storage only**: File persistence requires additional browser APIs
2. **Platform-specific**: Windows support limited, macOS requires llvm.org Clang
3. **Upstream dependencies**: Blocked by `ring` crate WASM support
4. **No NAT traversal**: Full P2P hole punching may not work in all browser environments

## References

- [Common WASM/browser Troubleshooting](https://github.com/n0-computer/iroh/discussions/3200) - Official iroh discussion
- [iroh WebAssembly Support](https://www.iroh.computer/docs/wasm-browser-support)
- [Iroh & the Web](https://www.iroh.computer/blog/iroh-and-the-web)
- [Issue #2799: WebAssembly support tracking](https://github.com/n0-computer/iroh/issues/2799)
- [ring Issue #657: Build fails for wasm32-unknown-unknown](https://github.com/briansmith/ring/issues/657)

## Current Implementation

The browser crate successfully implements full iroh P2P file transfer for the browser:

- **`src/lib.rs`** - Main entry point
- **`src/node.rs`** - Core SendmeNode using `Endpoint::builder().bind()` for WASM-compatible key generation
- **`src/wasm.rs`** - WASM bindings via `wasm-bindgen`
- **`public/index.html`** - Demo web interface with send/receive tabs

### Key Features
- ✅ Proper BlobTicket creation with endpoint addressing (relay URLs, direct addresses)
- ✅ P2P connection and remote blob fetching via `get_hash_seq_and_sizes`
- ✅ Endpoint online status checking with `wait_for_ready()`
- ✅ JavaScript setTimeout for WASM-compatible async sleeping
- ✅ Workspace exclusion to prevent `mio` dependency conflicts

### Build Requirements
1. Using llvm.org Clang on macOS (not Apple Clang): `export CC=/opt/homebrew/opt/llvm/bin/clang`
2. Browser crate has its own `[workspace]` section to exclude from parent workspace
3. wasm-bindgen version 0.2.105 (must match Cargo.toml)
