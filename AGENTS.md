# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendme`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **WASM browser** - Experimental (separate build: `browser-lib/`)
- **Cloudflare Workers** - Presence service (`sendme-presence/`)

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Cargo Workspace Structure

```
sendme-app/
├── lib/                    # sendme-lib - Core library (send/receive/nearby)
├── cli/                    # sendme CLI - Binary using sendme-lib
├── app/src-tauri/          # Tauri backend
├── browser-lib/            # WASM bindings (separate workspace - NOT in main)
├── browser/                # Browser demo (separate)
└── sendme-presence/        # Cloudflare Durable Objects (separate)
```

**Key**: `browser-lib` has its own `[workspace]` - never add it to main workspace.

## Build Commands

### Rust
```bash
cargo build --release
cargo build -p sendme-lib      # Library only
cargo build -p sendme         # CLI only
cargo build -p app             # Tauri backend only

cargo fmt --all               # Required before commit
cargo clippy --locked --workspace --all-targets --all-features
```

### Tests
```bash
cargo test --locked --workspace --all-features
IROH_FORCE_STAGING_RELAYS=1 cargo test  # Like CI
cargo test send_recv_file                # Specific test
```

### Tauri App
```bash
cd app
pnpm install
pnpm run tauri dev        # Dev with hot reload
pnpm run tauri build     # Production build
```

### Browser WASM (separate workspace)
```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # LLVM Clang, NOT Apple Clang
cargo build --target=wasm32-unknown-unknown --release
```

### Mobile Builds
```bash
# Android
CLERK_PUBLISHABLE_KEY='pk_test_...' pnpm run tauri android build

# iOS (preferred: direct xcodebuild + devicectl)
cd app
export CLERK_PUBLISHABLE_KEY='pk_test_...'
cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
```

## Critical Patterns

### Router Keep-Alive (CRITICAL)
```rust
// Sender's router must stay alive to serve incoming connections
tokio::spawn(async move {
    let _router = router;
    std::future::pending::<()>().await;  // Runs forever
});
```
Never replace with sleep loop.

### Android Temp Directory (CRITICAL)
```rust
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);
```
Always use `args.common.temp_dir` - Android sandbox blocks `current_dir()`.

### Tokio RwLock
Use `tokio::sync::RwLock`, NOT `std::sync::RwLock` for async state.

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send
2. **Browser WASM**: Never add `browser-lib` to workspace members
3. **Tauri errors**: Convert Rust errors to String with messages for frontend
4. **Path validation**: Always use `canonicalized_path_to_string()`
5. **Android temp**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
6. **iOS signing**: `app_iOS.entitlements` must stay empty for personal-team signing
7. **WASM macOS**: Use LLVM Clang, NOT Apple Clang

## Environment Variables

- `IROH_SECRET`: Hex-encoded 32-byte secret (optional, auto-generates)
- `IROH_FORCE_STAGING_RELAYS=1`: Use staging relays (CI/tests)
- `RUSTFLAGS=-Dwarnings`: All warnings are errors (CI)
- `CLERK_PUBLISHABLE_KEY`: Clerk key for mobile (compile-time required)

## MSRV

Minimum Supported Rust Version: **1.81**

## Key Dependencies

- **Rust**: iroh 0.97, iroh-blobs 0.99, tokio 1.34, tauri 2
- **JS**: solid-js, @solidjs/start, vinxi, tailwindcss 4

## Additional Docs

- `ANDROID_DEBUG_GUIDE.md` - Android debugging workflow
- `ANDROID_FIX_SUMMARY.md` - Android temp directory fixes
- `GEMINI.md` - Additional guidance