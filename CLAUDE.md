# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendme is a cross-platform P2P file transfer system built on `iroh`.

There are four distinct products in this repo:
- `lib/` — shared Rust transfer engine (`sendme-lib`)
- `cli/` — `sendme` terminal app and TUI
- `app/` + `app/src-tauri/` — Tauri desktop/mobile app with a SolidJS frontend
- `browser/` + `browser-lib/` — browser app plus WASM bindings

Additional crates:
- `app/src-tauri/plugins/tauri-plugin-clerk/` — custom Tauri plugin for Clerk auth on mobile
- `app/src-tauri/plugins/tauri-plugin-media-picker/` — custom Tauri plugin for iOS photo/video picking

`browser-lib/` is intentionally a separate Cargo workspace from the root workspace because the native workspace dependencies are not WASM-compatible.

Use `pnpm` for all JavaScript/TypeScript work.

## Common Commands

### Rust workspace

```bash
cargo build
cargo build --release
cargo build -p sendme-lib
cargo build -p cli            # builds the sendme binary
cargo build -p app            # builds the Tauri Rust backend

cargo test --locked --workspace --all-features
cargo test send_recv_file
cargo test --test cli
cargo test send_recv_file -- --nocapture
IROH_FORCE_STAGING_RELAYS=1 cargo test --locked --workspace --all-features

cargo fmt --all
cargo clippy --locked --workspace --all-targets --all-features
```

### Tauri app (`app/`)

```bash
cd app
pnpm install
pnpm run dev          # Vite frontend only
pnpm run build        # frontend build only
pnpm run tauri dev    # Tauri shell + frontend
pnpm run tauri build
pnpm run format
pnpm run test         # vitest

CLERK_PUBLISHABLE_KEY='pk_test_...' pnpm run tauri android build
export CLERK_PUBLISHABLE_KEY='pk_test_...'
cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
xcrun devicectl device process launch --console --terminate-existing --device <device-id> io.sendme.app
```

### Browser app (`browser/`)

```bash
cd browser
pnpm install
pnpm run build:wasm         # rebuild browser-lib output into browser/src/wasm
pnpm run build:wasm:release
pnpm run dev                # Vinxi dev server
pnpm run dev:cf             # wrangler dev on built output
pnpm run build
pnpm run preview
pnpm run deploy             # npm run build && wrangler deploy
pnpm run deploy:cf          # production deploy with minify
pnpm run db:generate
pnpm run db:migrate
pnpm run db:migrate:prod
pnpm run db:studio
pnpm run test               # vitest
```

`browser/package.json` requires Node `>=22`.

### Direct WASM crate build (`browser-lib/`)

```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # macOS: use llvm clang, not Apple clang
cargo build --target=wasm32-unknown-unknown
cargo build --target=wasm32-unknown-unknown --release
```

## High-Level Architecture

### Shared transfer core (`lib/`)

`sendme-lib` is the protocol and transfer layer used by the CLI and Tauri app.

Key modules:
- `send.rs` — imports files into an `FsStore`, builds an `iroh` endpoint, creates a `BlobTicket`, and keeps the provider router alive
- `receive.rs` — connects using a ticket, downloads missing blobs into a temp store, then exports files to the destination
- `import.rs` / `export.rs` — filesystem ↔ blob-store conversion
- `progress.rs` — transfer progress event types shared by UI layers
- `types.rs` — shared request/config types
- `nearby/` — local-network discovery and nearby transfer protocol

The main send/receive contract across products is an `iroh_blobs::ticket::BlobTicket` using collection/`HashSeq` data, so filenames and directory structure survive across CLI, Tauri, and browser flows.

### CLI (`cli/`)

`cli/src/main.rs` supports both explicit `send`/`receive` subcommands and the default ratatui TUI.

The TUI lives under `cli/src/tui/` and uses background async tasks plus `sendme-lib` progress channels rather than implementing transfer logic itself.

### Tauri app (`app/` + `app/src-tauri/`)

This is split cleanly between a Solid frontend and a Rust backend:
- `app/src/bindings.ts` is the typed wrapper layer for Tauri commands
- `app/src/lib/store.tsx` holds the shared client-side transfer and nearby UI state
- `app/src/routes/index.tsx` is the main transfer UI
- `app/src/routes/nearby.tsx` and `app/src/routes/friends.tsx` layer extra workflows on top of the same backend

Most backend logic lives in one large file: `app/src-tauri/src/lib.rs`.
That file contains:
- Tauri command handlers such as `send_file`, `receive_file`, `send_text`, `get_transfers`, `pick_file`, `pick_directory`, `start_nearby_discovery`, `send_to_device`, and `accept_incoming`
- the in-memory transfer registry (`Arc<RwLock<HashMap<String, TransferState>>>`)
- progress emission to the frontend via Tauri events
- platform-specific mobile file handling
- desktop system tray (`menubar.rs`) and menubar panel commands (`menubar_cmd.rs`)
- Clerk auth deep link callback handler (`handle_clerk_auth_callback`)

Nearby-device support crosses layers:
- protocol/discovery primitives are in `lib/src/nearby/*`
- the Tauri backend keeps a `NearbyRuntime` with the live endpoint, discovery instance, and pending approval state
- the frontend subscribes to backend events and renders nearby send/receive state from the global store

Desktop system tray:
- `app/src-tauri/src/menubar.rs` creates the tray icon with Show/Exit menus
- Clicking the tray icon shows and focuses the main window
- The tray uses `include_bytes!("../icons/tray.png")` for its icon

### Browser app (`browser/`)

`browser/` is a separate SolidStart/Vinxi application for web-based transfers and cross-device sync. It is not the same frontend as `app/`.

The browser app has two major halves:
- client UI under `browser/src/routes/app/` and `browser/src/components/`
- server routes under `browser/src/routes/api/`

The browser-specific backend stack is Cloudflare-based:
- `browser/src/lib/db/schema.ts` defines the D1 schema for users, devices, tickets, transfers, and friendships
- `browser/src/routes/api/tickets/index.ts` persists tickets and broadcasts updates
- `browser/src/routes/api/ws.ts` upgrades to a WebSocket and routes it into a user-scoped Durable Object
- `browser/src/worker/durable-objects/user.ts` is the real-time hub for device presence, pending tickets, and friend updates

Real-time state is managed on the client by `browser/src/lib/composables/useWebSocket.ts`, which maintains a singleton WebSocket connection with automatic reconnect, heartbeat, and device registration deduplication (via `deviceRegistration.ts`). The Clerk JWT is passed as a query parameter because browsers cannot set custom headers on WebSocket connections.

`browser/app.config.ts` contains two custom Rollup plugins that are critical for Cloudflare deployment:
- `cloudflareDoExportsPlugin` — injects the `UserDO` named export into the worker entry so Wrangler can bind it
- `cloudflareWsBypassPlugin` — intercepts `/api/ws` upgrade requests before Nitro's h3 pipeline reconstructs the Response, preserving Cloudflare's special `webSocket` property required for Durable Object handshakes

### Browser WASM layer (`browser-lib/`)

`browser-lib` is the browser-side Rust node.

`browser-lib/src/node.rs` creates an in-memory `iroh`/`iroh-blobs` node using `MemStore`, imports browser file bytes, creates compatible `BlobTicket`s, and fetches data back by ticket.

`browser/src/lib/commands.ts` is the JS bridge that lazily loads the generated WASM module, creates a singleton node instance, and exposes browser-friendly send/receive helpers.

If you change the WASM API or Rust browser logic, rebuild the generated artifacts in `browser/src/wasm` with `pnpm run build:wasm` from `browser/`.

## Critical Repo-Specific Details

- Keep the sender router alive. `lib/src/send.rs` intentionally parks the router with `std::future::pending()`; dropping the router breaks later incoming connections.
- Use `CommonConfig.temp_dir` on sandboxed platforms instead of assuming the current directory. This matters for Android/macOS temp storage and file import/export flows.
- Android file picking is URI-based, not normal-path-based. The Tauri backend copies `content://` URIs into temp files before sending and writes received files back through the Android FS plugin.
- Do not add `browser-lib` to the root Cargo workspace.
- The two Solid frontends serve different runtimes: `app/` is the Tauri UI, `browser/` is the Cloudflare web app. Similar-looking UI code in one does not imply shared state or shared build configuration with the other.
- For Tauri commands, convert Rust errors to `String` for the frontend (for example, `map_err(|e| format!("Failed to send: {}", e))?`).

### Async Patterns

```rust
// Progress channels
tokio::sync::mpsc::channel::<ProgressEvent>(32)

// Abort signals
tokio::sync::oneshot::channel::<()>();

// Shared state - use tokio RwLock, NOT std::sync::RwLock
tokio::sync::RwLock<HashMap<String, State>>

// CRITICAL: Keep routers alive in async contexts
std::future::pending::<()>().await

// Select with cancellation
tokio::select! {
    _ = cancel_rx.recv() => return,
    result = async_operation() => result?,
}
```

### TypeScript/SolidJS

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { send_file, type SendFileRequest } from "~/lib/commands";

// Explicit types for signals
const [devices, setDevices] = createSignal<NearbyDevice[]>([]);

// Path aliases use ~/* for src/
```

## Important Implementation Details

### Router Keep-Alive (CRITICAL)

**The sender's router must stay alive to serve incoming connections:**

```rust
tokio::spawn(async move {
    let _router = router;
    std::future::pending::<()>().await;  // Runs forever
});
```

If the router is dropped, no new connections can be established. Never replace with a sleep loop.

### Android Temp Directory (CRITICAL)

Android apps run in a sandbox. Always use `args.common.temp_dir`:

```rust
// CORRECT: Use temp_dir from config
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);

// In Tauri backend
let temp_dir = app.path().temp_dir()?;
let args = ReceiveArgs {
    common: CommonConfig {
        temp_dir: Some(temp_dir),  // CRITICAL for Android
        ..
    },
    ..
};
```

### Recursion Limit

If you encounter "recursion limit reached" compilation errors, add to `app/src-tauri/src/lib.rs`:

```rust
#![recursion_limit = "256"]
```

### Progress Channels

- Use `tokio::sync::mpsc::channel(32)` for progress event streaming
- Frontend uses `listen("progress", callback)` to receive events

### Abort Handling

- Each transfer has `Option<tokio::sync::oneshot::Sender<()>>` for abort
- Cancel sends `()` through channel, task listens via `abort_rx.await`

## Mobile Development

### Clerk Authentication (Required)

Android/iOS apps cannot access runtime environment variables. The Clerk publishable key must be embedded at compile time:

```bash
# Build with Clerk publishable key
CLERK_PUBLISHABLE_KEY='pk_test_YOUR_KEY_HERE' pnpm run tauri android build
cd app
export CLERK_PUBLISHABLE_KEY='pk_test_YOUR_KEY_HERE'
cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
```

- Test key (`pk_test_...`) for development
- Production key (`pk_live_...`) for release builds
- Prefer direct `xcodebuild` over `pnpm run tauri ios build` in this repo; the latter can fail during archive/export by reintroducing unsupported entitlements for personal-team signing.

### Clerk Auth Flow (System Browser + Deep Link)

The Tauri app uses system-browser OAuth instead of an in-app WebView:
1. Frontend calls `open_system_browser(url)` to open the OAuth page in the system browser
2. User authenticates with the OAuth provider
3. Clerk redirects to the app via a deep link (`sendme://auth-callback?__clerk_db_jwt=...`)
4. `handle_clerk_auth_callback` in `lib.rs` extracts the `__clerk_db_jwt` token, sets it on the FAPI client, refreshes the Clerk session, and emits `clerk-auth-callback-complete`
5. Frontend listens for `clerk-auth-callback-complete` and refreshes auth state

This avoids a 30-second timeout that occurs when `handshake_client` follows a 302 redirect into an OAuth page inside reqwest.

### Platform-Specific File Picking

- **Android**: Uses `tauri_plugin_android_fs` for file/directory picking
- **iOS**: Uses `tauri_plugin_fs_ios` for Documents access, and a custom `tauri-plugin-media-picker` (Swift + Rust) for photo/video selection via `PHPickerViewController`
- **Desktop**: Uses `tauri_plugin_dialog`

### iOS Safari Web Inspector

Enable the `ios-web-inspector` feature in `app/src-tauri/Cargo.toml` to allow Safari DevTools debugging of the iOS WebView:

```toml
[features]
default = ["ios-web-inspector"]
ios-web-inspector = []
```

When enabled, the app calls `setInspectable:true` on the `WKWebView` at startup.

## Environment Variables

- **`IROH_SECRET`**: Hex-encoded 32-byte secret key (optional, generates random if not set)
- **`IROH_FORCE_STAGING_RELAYS`**: Set to `1` to use staging relays (CI tests)
- **`RUST_LOG`**: Tracing level (debug, info, warn, error)
- **`RUSTFLAGS=-Dwarnings`**: Treat all warnings as errors (CI)
- **`CLERK_PUBLISHABLE_KEY`**: Clerk key for mobile builds (compile-time)

## MSRV

Minimum Supported Rust Version: **1.81**

## Additional Documentation

- **`ANDROID_DEBUG_GUIDE.md`**: Step-by-step Android debugging workflow
- **`ANDROID_FIX_SUMMARY.md`**: Details on Android temp directory fixes
