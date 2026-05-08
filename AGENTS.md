# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendme`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **Browser app** (`browser/`) - SolidStart/Cloudflare Workers (separate from Tauri frontend)
- **WASM browser** - Experimental (separate build: `browser-lib/`)

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Cargo Workspace Structure

```
sendme-app/
├── lib/                    # sendme-lib - Core library (send/receive/nearby)
├── cli/                    # sendme CLI - Binary using sendme-lib
├── app/src-tauri/          # Tauri backend
│   └── plugins/            # tauri-plugin-clerk, tauri-plugin-media-picker, clerk-fapi-rs
├── browser-lib/            # WASM bindings (separate workspace - NOT in main)
└── browser/                # Browser/Cloudflare app (separate SolidStart, NOT the Tauri UI)
```

**Key**: `browser-lib` has its own `[workspace]` - never add it to main workspace.
**Key**: pnpm workspace contains only `app` and `browser` (`pnpm-workspace.yaml`).
**Key**: `[patch.crates-io] n0-snafu = { path = "patches/n0-snafu" }` — local patch fixes color-backtrace incompatibility; do not remove.

## Build Commands

### Rust
```bash
cargo build --release
cargo build -p sendme-lib      # Library only
cargo build -p cli             # CLI only (package name 'cli', binary name 'sendme')
cargo run -p cli               # Run the TUI directly
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

**Linux Tauri build dependencies** (Ubuntu 22.04):
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Browser App (`browser/`) - separate SolidStart app, NOT the Tauri UI
```bash
cd browser
pnpm install
pnpm run build:wasm           # Build WASM from browser-lib (debug)
pnpm run build:wasm:release   # Build WASM release
pnpm run dev                  # Vinxi dev server (local)
pnpm run dev:cf               # wrangler dev on built output
pnpm run build                # Build for production
pnpm run preview
pnpm run deploy:cf            # Deploy to Cloudflare Workers (use this, NOT deploy)
pnpm run db:generate          # Generate drizzle migration files
pnpm run db:migrate           # Apply D1 migrations locally
pnpm run db:migrate:prod      # Apply D1 migrations to production
pnpm run db:studio            # Drizzle Studio UI
pnpm test                     # Vitest
```
Node >=22 required. Use `deploy:cf` not `deploy` — `deploy` internally calls `npm run build` which fails with pnpm.

### Browser WASM (separate workspace)
```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # LLVM Clang, NOT Apple Clang
cargo build --target=wasm32-unknown-unknown --release
```
After changing WASM API or Rust browser logic, rebuild artifacts with `pnpm run build:wasm` from `browser/`.

### Mobile Builds
```bash
# Android
# CLERK_PUBLISHABLE_KEY is read from system environment
pnpm run tauri android build

# iOS (preferred: direct xcodebuild + devicectl, NOT pnpm run tauri ios build)
# tauri ios build can fail during archive/export due to unsupported entitlements for personal-team signing
# See docs/ios-build-install.md for the full step-by-step guide.
cd app
cd src-tauri/gen/apple
xcodegen generate
nohup xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios -allowProvisioningUpdates -allowProvisioningDeviceRegistration CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=UJ8NW4N779 CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" build > /tmp/xcodebuild.log 2>&1 &
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
xcrun devicectl device process launch --terminate-existing --device <device-id> io.sendme.app
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

### TypeScript/SolidJS Conventions
```typescript
// Path alias: ~/* maps to src/
import { send_file, type SendFileRequest } from "~/lib/commands";

// Explicit types for signals
const [devices, setDevices] = createSignal<NearbyDevice[]>([]);
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
11. **Two SolidJS frontends**: `app/src/` is the Tauri UI; `browser/src/` is the Cloudflare web app. Separate builds, no shared state

## Platform-Specific File Picking

- **Android**: `tauri_plugin_android_fs` (URI-based, copies to temp)
- **iOS**: `tauri_plugin_fs_ios` + Documents directory (no directory picking); custom `tauri-plugin-media-picker` (Swift + Rust, `PHPickerViewController`) for photo/video
- **Desktop**: `tauri_plugin_dialog`

## Clerk Auth (Mobile)

Android/iOS cannot access runtime env vars — `CLERK_PUBLISHABLE_KEY` must be embedded at compile time.

Auth flow uses system browser + deep link, NOT in-app WebView:
1. Frontend calls `open_system_browser(url)` → system browser OAuth
2. Clerk redirects to `sendme://auth-callback?__clerk_db_jwt=...`
3. `handle_clerk_auth_callback` in `lib.rs` extracts token, sets it on FAPI client, emits `clerk-auth-callback-complete`
4. Frontend refreshes auth state on that event

Custom plugins in `app/src-tauri/plugins/`:
- `tauri-plugin-clerk` — Clerk auth integration
- `tauri-plugin-media-picker` — iOS photo/video selection
- `clerk-fapi-rs` — Clerk FAPI client

## iOS Safari Web Inspector

Enable `ios-web-inspector` feature in `app/src-tauri/Cargo.toml` to debug the iOS WebView with Safari DevTools. This calls `setInspectable:true` on `WKWebView` at startup.

## Environment Variables

- `IROH_SECRET`: Hex-encoded 32-byte secret (optional, auto-generates)
- `IROH_FORCE_STAGING_RELAYS=1`: Use staging relays (CI/tests)
- `RUSTFLAGS=-Dwarnings`: All warnings are errors (CI)
- `RUST_LOG`: Tracing level (debug, info, warn, error)
- `CLERK_PUBLISHABLE_KEY`: Clerk key for mobile (compile-time required, set in system environment)
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
- `browser/src/worker/durable-objects/user.ts` — real-time hub for Cloudflare device presence/tickets (Durable Objects are inside `browser/`, not a separate package)
- `browser/src/lib/commands.ts` — JS bridge that lazily loads WASM, exposes send/receive helpers
- `browser/app.config.ts` — two critical Rollup plugins: `cloudflareDoExportsPlugin` (injects `UserDO` export for Wrangler) and `cloudflareWsBypassPlugin` (preserves Cloudflare WebSocket property for DO handshakes)

## Releases

Releases trigger on `v*` tag pushes. CI builds:
- CLI for Linux/macOS/Windows (multiple architectures)
- Tauri desktop app for macOS/Linux/Windows
- Android APK/AAB (requires `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64` secrets; uses NDK 27.0.12077973)

## Commit Convention

Prefix commit messages with the component when applicable:
- `cli: fix progress bar`
- `app: update send screen`
- `lib: add nearby discovery`
- `browser: fix WebSocket reconnect`

## Additional Docs

- `ANDROID_DEBUG_GUIDE.md` - Android debugging workflow
- `ANDROID_FIX_SUMMARY.md` - Android temp directory fixes
- `ANDROID_FILENAME_PRESERVATION.md` - Android filename handling
- `GEMINI.md` - Additional guidance
- `CLAUDE.md` - Detailed architecture and patterns reference
