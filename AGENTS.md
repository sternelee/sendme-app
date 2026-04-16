# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendme`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **Browser app** (`browser/`) - SolidStart/Cloudflare Workers (separate from Tauri frontend)
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
├── browser/                # Browser/Cloudflare app (separate SolidStart, NOT the Tauri UI)
└── sendme-presence/        # Cloudflare Durable Objects (separate)
```

**Key**: `browser-lib` has its own `[workspace]` - never add it to main workspace.

## Build Commands

### Rust
```bash
cargo build --release
cargo build -p sendme-lib      # Library only
cargo build -p sendme         # CLI only (binary is 'sendme', package is 'cli')
cargo build -p app             # Tauri backend only

cargo fmt --all               # Required before commit
cargo clippy --locked --workspace --all-targets --all-features
```

### Tests
```bash
cargo test --locked --workspace --all-features
IROH_FORCE_STAGING_RELAYS=1 cargo test  # Like CI
cargo test send_recv_file                # Specific test
cargo test --test cli                   # CLI integration tests
cargo test send_recv_file -- --nocapture
```

### Tauri App (`app/`)
```bash
cd app
pnpm install
pnpm run dev          # Vite frontend ONLY (no Tauri shell)
pnpm run tauri dev    # Tauri shell + frontend (hot reload)
pnpm run tauri build  # Production build
pnpm run format       # Prettier
pnpm test             # Vitest
```

### Browser App (`browser/`) - separate SolidStart app, NOT the Tauri UI
```bash
cd browser
pnpm install
pnpm run build:wasm           # Build WASM from browser-lib (debug)
pnpm run build:wasm:release   # Build WASM release
pnpm run dev                  # Local dev server
pnpm run build                # Build for production
pnpm run deploy:cf            # Deploy to Cloudflare Workers
pnpm run db:migrate           # Apply D1 migrations locally
pnpm run db:migrate:prod      # Apply D1 migrations to production
```
Node >=22 required. Use `deploy:cf` not `deploy` (the `deploy` script internally calls `npm run build` which may fail with pnpm).

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

# iOS (preferred: direct xcodebuild + devicectl, NOT pnpm run tauri ios build)
# tauri ios build can fail during archive/export due to unsupported entitlements for personal-team signing
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
Never replace with sleep loop. Dropping the router breaks all subsequent incoming connections.

### Android Temp Directory (CRITICAL)
```rust
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);
```
Always use `args.common.temp_dir` - Android sandbox blocks `current_dir()`.

In Tauri backend: `let temp_dir = app.path().temp_dir()?` then pass as `CommonConfig { temp_dir: Some(temp_dir), .. }`.

### Tokio RwLock
Use `tokio::sync::RwLock`, NOT `std::sync::RwLock` for async shared state.

### Async Patterns
```rust
// Progress channels
tokio::sync::mpsc::channel::<ProgressEvent>(32)

// Abort/cancel
tokio::sync::oneshot::channel::<()>()

// Select with cancellation
tokio::select! {
    _ = cancel_rx.recv() => return,
    result = async_operation() => result?,
}
```

### Tauri Error Handling
Convert Rust errors to String for the frontend:
```rust
.map_err(|e| format!("Failed to send: {}", e))?
```

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send
2. **Browser WASM**: Never add `browser-lib` to workspace members
3. **Tauri errors**: Convert Rust errors to String with messages for frontend
4. **Path validation**: Always use `canonicalized_path_to_string()`
5. **Android temp**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
6. **iOS signing**: `app_iOS.entitlements` must stay empty for personal-team signing; prefer direct `xcodebuild` over `pnpm run tauri ios build`
7. **WASM macOS**: Use LLVM Clang, NOT Apple Clang
8. **Android JNI**: Use `push_local_frame()`/`pop_local_frame()` in loops to prevent JNI reference leaks
9. **Recursion limit**: If compilation fails with "recursion limit reached", add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`
10. **Android file picking**: Android uses URI-based picking (`content://`); the Tauri backend copies URIs to temp files before processing
11. **Two SolidJS frontends**: `app/src/` is the Tauri UI; `browser/src/` is the Cloudflare web app. They are separate builds with no shared state

## Platform-Specific File Picking

- **Android**: `tauri_plugin_android_fs` (URI-based, copies to temp)
- **iOS**: `tauri_plugin_fs_ios` + Documents directory (no directory picking)
- **Desktop**: `tauri_plugin_dialog`

## Environment Variables

- `IROH_SECRET`: Hex-encoded 32-byte secret (optional, auto-generates)
- `IROH_FORCE_STAGING_RELAYS=1`: Use staging relays (CI/tests)
- `RUSTFLAGS=-Dwarnings`: All warnings are errors (CI)
- `RUST_LOG`: Tracing level (debug, info, warn, error)
- `CLERK_PUBLISHABLE_KEY`: Clerk key for mobile (compile-time required)
  - `pk_test_...` for development; `pk_live_...` for production release builds

## MSRV

Minimum Supported Rust Version: **1.81**

## Key Dependencies

- **Rust**: iroh 0.97, iroh-blobs 0.99, tokio 1.34, tauri 2
- **JS**: solid-js, @solidjs/start, vinxi, tailwindcss 4, daisyui 5

## Architecture Notes

- `lib/src/send.rs` — imports files into `FsStore`, creates `BlobTicket`, keeps router alive
- `lib/src/receive.rs` — connects by ticket, downloads blobs, exports to destination
- `lib/src/nearby/` — local-network discovery protocol
- `app/src-tauri/src/lib.rs` — single large file with ALL Tauri command handlers, transfer registry, progress emission, and platform-specific logic
- `app/src/bindings.ts` — typed wrapper for Tauri commands
- `app/src/lib/store.tsx` — shared client-side transfer and nearby UI state
- `browser/src/worker/durable-objects/user.ts` — real-time hub for Cloudflare device presence/tickets
- `browser/src/lib/commands.ts` — JS bridge that lazily loads WASM, exposes send/receive helpers

## Additional Docs

- `ANDROID_DEBUG_GUIDE.md` - Android debugging workflow
- `ANDROID_FIX_SUMMARY.md` - Android temp directory fixes
- `ANDROID_FILENAME_PRESERVATION.md` - Android filename handling
- `GEMINI.md` - Additional guidance
- `CLAUDE.md` - Detailed architecture and patterns reference
