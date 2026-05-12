# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a **cross-platform P2P file transfer system** built on [iroh](https://iroh.computer). It supports direct peer-to-peer file and text transfers via `BlobTicket`s, local-network discovery (mDNS/Bonjour), and cloud-backed cross-device sync.

There are **four distinct products** in this repo:

| Product              | Location                    | Technology                | Targets                 |
| -------------------- | --------------------------- | ------------------------- | ----------------------- |
| Core library         | `lib/`                      | Rust (`sendme-lib`)       | CLI, Tauri, WASM        |
| CLI / TUI            | `cli/`                      | Rust (`ratatui`, `clap`)  | Linux, macOS, Windows   |
| Desktop / Mobile app | `app/` + `app/src-tauri/`   | Tauri 2 + SolidJS         | Desktop + Android + iOS |
| Browser app          | `browser/` + `browser-lib/` | SolidStart / Vinxi + WASM | Cloudflare Workers      |

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Repository Structure

```
sendme-app/
├── Cargo.toml                # Root workspace manifest
├── pnpm-workspace.yaml       # pnpm workspace: app, browser
├── lib/                      # sendme-lib — Core P2P transfer engine
│   ├── src/send.rs           # Import files, create BlobTicket, keep router alive
│   ├── src/receive.rs        # Connect by ticket, download, export
│   ├── src/import.rs         # Filesystem → FsStore
│   ├── src/export.rs         # FsStore → filesystem
│   ├── src/progress.rs       # ProgressEvent types for UI layers
│   ├── src/types.rs          # CommonConfig, SendArgs, ReceiveArgs, etc.
│   └── src/nearby/           # mDNS/Bonjour discovery + direct QUIC transfer
├── cli/                      # sendme CLI binary (package name: cli, bin: sendme)
│   └── src/tui/              # ratatui interactive terminal UI
├── app/                      # Tauri 2 frontend (SolidJS + Vite)
│   ├── src/                  # SolidJS UI code
│   ├── src-tauri/src/lib.rs  # All Tauri command handlers (~4,800 lines)
│   └── src-tauri/plugins/    # Custom tauri-plugin-media-picker (iOS)
├── browser/                  # SolidStart web app (Cloudflare Workers)
│   ├── src/routes/api/       # REST API + WebSocket upgrade handler
│   ├── src/worker/durable-objects/user.ts  # UserDO real-time hub
│   └── src/wasm/             # Generated wasm-bindgen artifacts
├── browser-lib/              # Standalone WASM crate (separate workspace!)
│   └── src/node.rs           # In-memory iroh node for browser P2P
├── packages/shared-types/    # Shared TypeScript types
├── patches/n0-snafu/         # Local crates.io patch
├── tests/cli.rs              # CLI integration tests (send/recv file & dir)
└── docs/                     # ios-build-install.md, nearby-discovery.md, etc.
```

**Key rules:**

- `browser-lib/` has its own `[workspace]` in `Cargo.toml` — **never add it to the root workspace**.
- The pnpm workspace contains only `app` and `browser`.
- `[patch.crates-io] n0-snafu = { path = "patches/n0-snafu" }` fixes a `color-backtrace` incompatibility; do not remove.

## Technology Stack

### Rust

- **MSRV**: 1.81
- **iroh** 0.97 (P2P networking, endpoint, router, relay)
- **iroh-blobs** 0.99 (content-addressed blob store, collections, tickets)
- **tokio** 1.34 (async runtime)
- **tauri** 2 (desktop/mobile app shell)

### JavaScript / TypeScript

- **solid-js** 1.9.x (fine-grained reactivity)
- **@solidjs/start** + **vinxi** (browser full-stack framework)
- **@solidjs/router** (routing)
- **tailwindcss** v4 + **daisyui** 5 (styling)
- **better-auth** (auth for browser and Tauri apps)
- **drizzle-orm** + **drizzle-kit** (D1 SQLite ORM)
- **wrangler** (Cloudflare Workers deployment)

### Cloud Infrastructure (Browser App)

- **Cloudflare Workers** (serverless compute)
- **D1** (SQLite edge database)
- **Durable Objects** (`UserDO` — per-user real-time hub)

## Build Commands

### Rust Workspace

```bash
cargo build --release
cargo build -p sendme-lib              # Library only
cargo build -p cli                     # CLI binary only (bin name: sendme)
cargo run -p cli                       # Run TUI directly
cargo build -p app                     # Tauri Rust backend only

cargo fmt --all
cargo clippy --locked --workspace --all-targets --all-features
```

### Tests

```bash
cargo test --locked --workspace --all-features
IROH_FORCE_STAGING_RELAYS=1 cargo test  # Like CI
cargo test send_recv_file                # Specific unit test
cargo test --test cli                    # CLI integration tests
cargo test send_recv_file -- --nocapture
```

### Tauri App (`app/`)

```bash
cd app
pnpm install
pnpm run dev                # Vite frontend ONLY (port 1420)
pnpm run tauri dev          # Tauri shell + frontend (hot reload)
pnpm run tauri build        # Production build
pnpm run format             # Prettier
pnpm test                   # Vitest
```

**Linux Tauri build dependencies** (Ubuntu 22.04):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Browser App (`browser/`)

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

Node >=22 is required. Use `deploy:cf` not `deploy` — `deploy` internally calls `npm run build` which fails with pnpm.

### Browser WASM (separate workspace)

```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # macOS: LLVM Clang, NOT Apple Clang
cargo build --target=wasm32-unknown-unknown --release
```

After changing WASM API or Rust browser logic, rebuild artifacts with `pnpm run build:wasm` from `browser/`.

### Mobile Builds

#### Android

```bash
# From app/
pnpm run tauri android build
```

#### iOS

Prefer direct `xcodebuild` + `devicectl` over `pnpm run tauri ios build`. The Tauri archive/export path can reintroduce unsupported entitlements for personal-team signing.

```bash
cd app/src-tauri/gen/apple
xcodegen generate

# Background build (10–12 min warm cache; use nohup so it survives terminal close)
nohup xcodebuild \
  -project app.xcodeproj \
  -scheme app_iOS \
  -sdk iphoneos \
  -configuration release \
  -derivedDataPath build-ios \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=UJ8NW4N779 \
  build > /tmp/xcodebuild.log 2>&1 &

# Install and launch
xcrun devicectl device install app --device <device-id> \
  "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
xcrun devicectl device process launch --terminate-existing --device <device-id> io.sendme.app
```

**First-time setup**: Before `xcodebuild` on a new machine, open the project once in Xcode GUI (`open app.xcodeproj`), select the **app_iOS** target → **Signing & Capabilities**, and confirm the Team is set. Otherwise `xcodebuild` fails with "No Accounts".

**Entitlements**: `app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements` must stay empty (`<dict></dict>`) for personal-team signing.

**Safari Web Inspector**: Set `SENDME_IOS_INSPECTOR=1` before building to enable Safari DevTools on the iOS WebView. This toggles the `ios-web-inspector` feature in `app/src-tauri/Cargo.toml`.

## Code Style & Conventions

### Rust

- `cargo fmt --all` is **required before commit**.
- Use `tokio::sync::RwLock`, NOT `std::sync::RwLock`, for async shared state.
- Convert Rust errors to `String` for Tauri frontend consumption:
  ```rust
  .map_err(|e| format!("Failed to send: {}", e))?
  ```
- Path safety: always use `canonicalized_path_to_string()` from `sendme-lib` instead of manual path string conversion.

### TypeScript / SolidJS

- Path alias: `~/*` maps to `src/` in both `app/` and `browser/`.
- Explicit types for signals:
  ```typescript
  const [devices, setDevices] = createSignal<NearbyDevice[]>([]);
  ```
- The two SolidJS frontends are **completely separate**:
  - `app/src/` → Tauri UI
  - `browser/src/` → Cloudflare web app
    No shared state, no shared build config.

### Commit Convention

Prefix commit messages with the component when applicable:

- `cli: fix progress bar`
- `app: update send screen`
- `lib: add nearby discovery`
- `browser: fix WebSocket reconnect`

## Critical Patterns

### Router Keep-Alive (CRITICAL)

The sender's iroh `Router` must never be dropped. Keep it alive forever in a spawned task:

```rust
tokio::spawn(async move {
    let _router = router;
    std::future::pending::<()>().await;  // Runs forever
});
```

Never replace with a sleep loop. Dropping the router breaks all subsequent incoming connections.

### Android Temp Directory (CRITICAL)

Android apps run in a sandbox where `std::env::current_dir()` is blocked. Always pass an explicit temp directory:

```rust
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);
```

In the Tauri backend:

```rust
let temp_dir = app.path().temp_dir()?;
let args = ReceiveArgs {
    common: CommonConfig {
        temp_dir: Some(temp_dir),
        ..
    },
    ..
};
```

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

### File Picking Per Platform

- **Android**: URI-based (`content://`) via `tauri-plugin-android-fs`. The backend copies URIs to temp files before processing and writes received files back through the Android FS plugin.
- **iOS**: `file://` URLs via dialog + Documents directory; custom `tauri-plugin-media-picker` (Swift + Rust, `PHPickerViewController`) for photo/video.
- **Desktop**: `tauri-plugin-dialog` returning real filesystem paths.

## Auth & Cloud Architecture

### Authentication

Both the Tauri app and the browser app authenticate against the **same better-auth instance** hosted on the browser app's Cloudflare backend.

**Tauri app flow (system browser + deep link):**

1. Frontend calls `open_system_browser(url)` → opens OAuth page in system browser.
2. User authenticates via better-auth (GitHub, Google, or email/password).
3. Browser callback deep-links back to the app: `sendme://auth/callback?token=...&user_id=...`.
4. Rust `handle_auth_callback` extracts the token and emits `auth-callback-complete`.
5. Frontend caches the bearer token for API/WebSocket auth.

**Browser app flow:**

- Standard better-auth session cookie (HttpOnly).
- Custom `/api/auth/token` endpoint exposes a bearer token for WebSocket auth (browsers cannot set custom headers on WS connections).
- API key auth (`sk_*` prefix) is supported for CLI/external clients; keys are SHA-256 hashed and stored in the `api_keys` table.

### Cloud Backend (Browser App)

- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM.
- **Schema**: `user`, `session`, `account`, `verification`, `devices`, `tickets`, `friends`, `api_keys`, `transfers`.
- **Real-time**: `UserDO` Durable Object (one per user) manages WebSocket pools, device presence, pending tickets, and friend list broadcasts.
- **WebSocket endpoint**: `/api/ws?deviceId=...&token=...` upgrades into the user's `UserDO`.
- **Critical build plugins** in `browser/app.config.ts`:
  - `cloudflareDoExportsPlugin` — injects `UserDO` named export into the worker entry so Wrangler can bind it.
  - `cloudflareWsBypassPlugin` — intercepts `/api/ws` upgrade requests before Nitro's h3 pipeline reconstructs the `Response`, preserving Cloudflare's special `webSocket` property required for Durable Object handshakes.

### CLI Cloud Connectivity

The CLI supports cloud sync via REST API + WebSocket:

- Config stored at `~/.config/sendme/config.toml` (`dirs::config_dir()`).
- REST client (`reqwest`) with `Authorization: Bearer <api_key>` and `X-Device-Id` headers.
- WebSocket loop (`tokio-tungstenite`) with exponential backoff reconnect (1s → 30s cap) and 30s heartbeat.
- Commands: `login`, `devices`, `friends`, `send --to-device`, `send --to-friend`.

## Platform-Specific Notes

### iOS

- `app_iOS.entitlements` must remain empty for personal-team signing.
- iOS cannot publish mDNS services without the `com.apple.developer.networking.multicast` entitlement (requires Apple Developer Program membership). On personal-team signing, iOS can receive nearby broadcasts but other devices may not see it.
- Enable `ios-web-inspector` feature in `app/src-tauri/Cargo.toml` for Safari DevTools debugging.

### Android

- `CHANGE_WIFI_MULTICAST_STATE` permission is required for iroh mDNS discovery. Must be present in `AndroidManifest.xml`.
- `sodium_memcmp` crash on launch: when cross-compiling Android on macOS, `libsodium-sys-stable` may produce an empty static library because the NDK's `llvm-ar` is not detected. See `ANDROID_DEBUG_GUIDE.md` for the one-time fix (pre-building libsodium with NDK toolchain).
- JNI loops must use `push_local_frame()` / `pop_local_frame()` to prevent reference leaks.

### macOS (Desktop)

- System tray / menubar integration via `app/src-tauri/src/menubar.rs`.
- Close button hides the window (activation policy `Accessory`) rather than quitting the app.
- `tauri-nspanel` plugin is integrated for future NSPanel support.

### WASM (Browser)

- `browser-lib` uses `MemStore` (in-memory only) because filesystem access is unavailable in WASM.
- `wasm-bindgen` is pinned to exactly `0.2.114`; `wasm-bindgen-cli` must match.
- macOS builds require **LLVM Clang** (`/opt/homebrew/opt/llvm/bin/clang`), NOT Apple Clang.

## Environment Variables

| Variable                                    | Purpose                                                              |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `IROH_SECRET`                               | Hex-encoded 32-byte secret key (optional; auto-generates if not set) |
| `IROH_FORCE_STAGING_RELAYS=1`               | Use staging relays (CI / tests)                                      |
| `RUSTFLAGS=-Dwarnings`                      | Treat all warnings as errors (CI)                                    |
| `RUST_LOG`                                  | Tracing level (`debug`, `info`, `warn`, `error`)                     |
| `SENDME_IOS_INSPECTOR=1`                    | Enable Safari Web Inspector on iOS builds                            |
| `BETTER_AUTH_SECRET`                        | better-auth session signing secret (browser backend)                 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth credentials (browser backend)                           |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (browser backend)                           |

> > > > > > > 1e042900bbf502a74b3b3015b2dacf100a3f8338

**Legacy**: `CLERK_PUBLISHABLE_KEY` references still exist in some build scripts (`app/src-tauri/build.rs`, iOS xcodebuild docs) but the runtime auth system has migrated to better-auth. Passing this variable is currently harmless but unnecessary.

## CI / CD & Releases

Releases trigger on `v*` tag pushes via `.github/workflows/release.yml`:

1. **CLI binaries** — built for Linux (x86_64), macOS (x86_64 + ARM64), Windows (x86_64 + ARM64).
2. **Tauri desktop apps** — built for macOS (ARM64 + Intel), Linux (Ubuntu 22.04), Windows.
3. **Android APK/AAB** — built on Ubuntu with NDK 27.0.12077973; requires `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64` secrets.

All artifacts are uploaded to a GitHub Release with auto-generated notes.

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` — critical for send operations.
2. **Browser WASM workspace**: Never add `browser-lib` to the root Cargo workspace members.
3. **Tauri errors**: Always convert Rust errors to `String` with descriptive messages for the frontend.
4. **Path validation**: Always use `canonicalized_path_to_string()`; never trust raw path strings.
5. **Android temp**: Use `args.common.temp_dir` or `app.path().temp_dir()` instead of `std::env::current_dir()`.
6. **iOS signing**: `app_iOS.entitlements` must stay empty for personal-team signing; prefer direct `xcodebuild` over `pnpm run tauri ios build`.
7. **WASM macOS**: Use LLVM Clang, NOT Apple Clang.
8. **Android JNI**: Use `push_local_frame()` / `pop_local_frame()` in loops to prevent JNI reference leaks.
9. **Recursion limit**: If compilation fails with "recursion limit reached", add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`.
10. **Android file picking**: Android uses URI-based picking (`content://`); the Tauri backend copies URIs to temp files before processing.
11. **Two SolidJS frontends**: `app/src/` is the Tauri UI; `browser/src/` is the Cloudflare web app. Separate builds, no shared state.
12. **Cloudflare WebSocket**: The `cloudflareWsBypassPlugin` in `browser/app.config.ts` is essential — without it, Nitro's h3 response reconstruction drops the `webSocket` property and Durable Object handshakes fail.

## Additional Documentation

- `ANDROID_DEBUG_GUIDE.md` — Android debugging workflow and libsodium cross-compile fix
- `ANDROID_FIX_SUMMARY.md` — Android temp directory fixes
- `ANDROID_FILENAME_PRESERVATION.md` — Android filename handling
- `docs/ios-build-install.md` — Full iOS build, install, and troubleshooting guide
- `docs/nearby-discovery.md` — mDNS service naming and iOS multicast entitlement limitations
- `API_CONTRACT_REFERENCE.md` — Cloud API contract details
- `CLOUD_ARCHITECTURE_DIAGRAM.txt` — Cloud architecture visual diagram
- `CLAUDE.md` — Detailed architecture and patterns reference
- `GEMINI.md` — Additional guidance
- `README.md` — Human-facing project overview
