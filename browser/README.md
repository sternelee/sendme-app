# Sendme Browser

Browser WebAssembly bindings for sendme file transfer.

## Status

✅ **Functional - Requires special build configuration**

This crate provides WASM bindings for sendme to run in browsers. The browser crate is **excluded from the workspace** because it requires WASM-specific dependency configuration that conflicts with native builds.

## Quick Start

```bash
cd browser

# Install dependencies (only needed once)
rustup target install wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105
pnpm install

# macOS only: Use llvm.org Clang (NOT Apple Clang)
export CC=/opt/homebrew/opt/llvm/bin/clang

# Build and serve
pnpm run build
pnpm run serve
```

Then open [`http://localhost:8080`](http://localhost:8080)

## What's New (2026-01-19)

### Improvements Based on `iroh-examples/browser-blobs`

1. **Simplified node.rs implementation**
   - Now uses official `Downloader` API instead of manual `get_hash_seq_and_sizes`
   - Better error handling and more reliable P2P connections
   - Added `endpoint.online().await` to ensure node is ready before creating tickets

2. **Better discovery management**
   - Properly integrates `StaticProvider` with endpoint discovery
   - `discovery.add_endpoint_info()` for remote peer info

3. **Cleaner architecture**
   - Uses `Store` trait for cleaner abstraction
   - Follows official iroh patterns more closely

4. **Build improvements**
   - Fixed package.json paths (use `./target` not `../target`)
   - Removed unused `hex` dependency
   - Added external CSS file for better maintainability

## Architecture

```
browser/
├── src/
│   ├── lib.rs          # Main entry point
│   ├── node.rs         # Core SendmeNode (uses Downloader API)
│   └── wasm.rs         # WASM bindings via wasm-bindgen
├── public/
│   ├── index.html      # Demo web interface
│   ├── style.css       # Styling
│   └── wasm/           # Generated WASM files (from build)
├── Cargo.toml          # Has [workspace] to exclude from parent
└── package.json        # Build scripts with pnpm
```

## Prerequisites

### Required Tools

```bash
# Install wasm32 target
rustup target install wasm32-unknown-unknown

# Install wasm-bindgen CLI (version must match Cargo.toml)
cargo install wasm-bindgen-cli --version 0.2.105

# Install Node.js dependencies
pnpm install
```

### Platform-Specific Requirements

#### macOS

**Critical**: Apple Clang does NOT support `wasm32-unknown-unknown`. You must use llvm.org Clang:

```bash
# Install llvm.org Clang via homebrew
brew install llvm

# Set CC environment variable (add to ~/.zshrc or ~/.bashrc)
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

## Build Commands

```bash
# Development build (with debug symbols)
pnpm run build

# Production build (optimized)
pnpm run build:release

# Serve locally
pnpm run serve
```

### Manual Build Steps

```bash
# 1. Build Rust to WASM
cargo build --target=wasm32-unknown-unknown

# 2. Generate JavaScript bindings
wasm-bindgen ./target/wasm32-unknown-unknown/debug/sendme_browser.wasm \
  --out-dir=public/wasm --weak-refs --target=web --debug

# 3. Serve
pnpm run serve
```

## Important: Build Configuration

The browser crate has its own `[workspace]` section in `Cargo.toml` to exclude it from the parent workspace. This prevents WASM-incompatible dependencies (like `mio`) from being pulled in.

When building, **always** use:

```bash
# From the browser directory
cd browser
cargo build --target=wasm32-unknown-unknown

# Or from the repository root (use --manifest-path)
cargo build --target=wasm32-unknown-unknown --manifest-path=browser/Cargo.toml
```

**DO NOT** use `cargo build -p sendme-browser` from the root - this will pull in workspace dependencies and fail.

## Common Issues

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

```bash
cargo install wasm-bindgen-cli --version 0.2.105 --force
```

## Testing with Official Examples

To verify your environment works, test with official iroh examples first:

```bash
git clone https://github.com/n0-computer/iroh-examples.git
cd iroh-examples/browser-blobs
npm install
npm run build
npm run serve
```

## Key Features

- ✅ Full P2P file transfer in the browser
- ✅ In-memory storage (no persistence yet)
- ✅ Proper BlobTicket creation with endpoint addressing
- ✅ Uses official `Downloader` API for reliability
- ✅ Discovery management with `StaticProvider`
- ✅ WASM-compatible async operations
- ✅ Clean web interface with progress indicators

## Known Limitations

1. **In-memory storage only**: File persistence requires additional browser APIs (IndexedDB)
2. **Platform-specific**: Windows support limited, macOS requires llvm.org Clang
3. **Upstream dependencies**: Dependent on `ring` crate WASM support
4. **NAT traversal**: Full P2P hole punching may not work in all browser environments
5. **No file metadata**: Currently transfers raw bytes, filename not preserved in transfer

## Implementation Details

### Core Components

**`src/node.rs`** - SendmeNode implementation
- Uses `Endpoint::bind()` for WASM-compatible key generation
- Integrates `Downloader` for reliable P2P fetching
- `StaticProvider` for discovery management
- `endpoint.online().await` ensures node readiness

**`src/wasm.rs`** - JavaScript bindings
- `wasm-bindgen` exports for browser
- Promise-based async operations
- `Uint8Array` for binary data transfer

**`public/index.html`** - Demo interface
- Send/Receive tabs
- Progress indicators
- Ticket sharing
- Node status display

## References

- [iroh-examples/browser-blobs](https://github.com/n0-computer/iroh-examples/tree/main/browser-blobs) - Official reference implementation
- [Common WASM/browser Troubleshooting](https://github.com/n0-computer/iroh/discussions/3200)
- [iroh WebAssembly Support](https://www.iroh.computer/docs/wasm-browser-support)
- [Iroh & the Web](https://www.iroh.computer/blog/iroh-and-the-web)
- [Issue #2799: WebAssembly support tracking](https://github.com/n0-computer/iroh/issues/2799)
- [ring Issue #657: Build fails for wasm32-unknown-unknown](https://github.com/briansmith/ring/issues/657)

## Contributing

When modifying the browser code:

1. Keep the `[workspace]` section in `Cargo.toml` - it's critical
2. Test on macOS with llvm.org Clang
3. Ensure wasm-bindgen version matches exactly
4. Follow patterns from `iroh-examples/browser-blobs`
5. Use official iroh APIs (`Downloader`, `Store`) when possible
