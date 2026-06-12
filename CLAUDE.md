# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendme is a cross-platform P2P file transfer system built on `iroh`.

There are four distinct products in this repo:
- `lib/` — shared Rust transfer engine (`sendme-lib`)
- `cli/` — `sendme` terminal app and TUI
- `app/` + `app/src-tauri/` — Tauri desktop/mobile app with a SolidJS frontend
- `browser/` + `browser-lib/` — browser app plus WASM bindings

Additional crates/packages:
- `app/src-tauri/plugins/tauri-plugin-media-picker/` — custom Tauri plugin for iOS photo/video picking
- `packages/shared/` — shared i18n string exports used by the Tauri UI
- `packages/ui/` — shared display helpers (file-size formatting, display names) and small components

`browser-lib/` is intentionally a separate Cargo workspace from the root workspace because the native workspace dependencies are not WASM-compatible.

The JS/TS side is a pnpm workspace (`pnpm-workspace.yaml`) covering `app/`, `browser/`, and `packages/*`. Use `pnpm` for all JavaScript/TypeScript work.

## Common Commands

### Rust workspace

```bash
cargo build
cargo build --release
cargo build -p sendme-lib
cargo build -p cli            # builds the sendme binary
cargo build -p app            # builds the Tauri Rust backend

cargo test --locked --workspace --all-features
cargo test -p sendme-lib
cargo test send_recv_file
cargo test --test cli
cargo test send_recv_file -- --nocapture
IROH_FORCE_STAGING_RELAYS=1 cargo test --locked --workspace --all-features

cargo fmt --all
cargo fmt --all -- --check   # CI dry-run
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
pnpm test -- <path-or-pattern>  # single test file/name

pnpm run tauri android build
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
pnpm test -- <path-or-pattern>  # single test file/name
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

This is split cleanly between a Solid frontend and a Rust backend.

Most backend logic lives in one large file: `app/src-tauri/src/lib.rs`.
That file contains:
- Tauri command handlers such as `send_file`, `receive_file`, `send_text`, `get_transfers`, `pick_file`, `pick_directory`, `start_nearby_discovery`, `send_to_device`, and `accept_incoming`
- the in-memory transfer registry (`Arc<RwLock<HashMap<String, TransferState>>>`)
- progress emission to the frontend via Tauri events
- platform-specific mobile file handling
- desktop system tray (`menubar.rs`) and menubar panel commands (`menubar_cmd.rs`)
- auth deep link callback handler (`handle_auth_callback`)

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

Real-time state is managed on the client by `browser/src/lib/composables/useWebSocket.ts`, which maintains a singleton WebSocket connection with automatic reconnect, heartbeat, and device registration deduplication (via `deviceRegistration.ts`). The bearer token is passed as a query parameter because browsers cannot set custom headers on WebSocket connections.

`browser/app.config.ts` contains two custom Rollup plugins that are critical for Cloudflare deployment:
- `cloudflareDoExportsPlugin` — injects the `UserDO` named export into the worker entry so Wrangler can bind it
- `cloudflareWsBypassPlugin` — intercepts `/api/ws` upgrade requests before Nitro's h3 pipeline reconstructs the Response, preserving Cloudflare's special `webSocket` property required for Durable Object handshakes

### Browser WASM layer (`browser-lib/`)

`browser-lib` is the browser-side Rust node.

`browser-lib/src/node.rs` creates an in-memory `iroh`/`iroh-blobs` node using `MemStore`, imports browser file bytes, creates compatible `BlobTicket`s, and fetches data back by ticket.

`browser/src/lib/commands.ts` is the JS bridge that lazily loads the generated WASM module, creates a singleton node instance, and exposes browser-friendly send/receive helpers.

If you change the WASM API or Rust browser logic, rebuild the generated artifacts in `browser/src/wasm` with `pnpm run build:wasm` from `browser/`.

## Tauri App Frontend

### State ownership

| Owner | What it holds |
| --- | --- |
| `app/src/lib/store.tsx` | Send/receive/nearby/cloud UI state |
| `app/src/lib/auth.tsx` | Auth/session state |
| `app/src/bindings.ts` | Typed boundary to the Rust backend (use this, not raw `invoke()`) |
| `app/src-tauri/src/lib.rs` | Transfer registry, event emission, nearby runtime, cloud state, mobile file handling |

### Important files

| File | Role |
| --- | --- |
| `app/src/routes/index.tsx` | Main app shell: tabs, nav, persistence, nearby/cloud modals, event wiring |
| `app/src/components/TransferTab.tsx` | Transfer workspace; primary mode switch (send/receive/text) and alternate channels (nearby/devices/friends) |
| `app/src/components/SendPanel.tsx` | File/text share flow, auto ticket generation, QR/copy/share card |
| `app/src/components/ReceivePanel.tsx` | Ticket paste/scan flow, destination selection, progress display |
| `app/src/lib/components/DropZone.tsx` | Desktop drag/drop + picker; mobile picker bridge |
| `app/src/lib/components/TransferProgress.tsx` | Shared progress card (speed, ETA, cancel) |
| `app/src/lib/components/IncomingRequestCard.tsx` | Accept/decline UI for nearby/cloud inbound transfers |
| `app/src-tauri/src/lib.rs` | All Tauri commands + backend runtime |
| `app/src-tauri/src/menubar.rs` | Desktop system tray (Show/Exit) |
| `lib/src/send.rs` | Core send logic; router keep-alive lives here |
| `lib/src/receive.rs` | Core receive/download logic |
| `lib/src/nearby/` | mDNS discovery primitives |
| `browser/src/worker/durable-objects/user.ts` | Cloudflare Durable Object: real-time device presence and ticket hub |
| `browser/app.config.ts` | Custom Rollup plugins required for DO exports and WebSocket handshakes |
| `browser/src/lib/commands.ts` | JS bridge for the WASM node |
| `packages/shared/` | Shared i18n string exports used in UI text |
| `packages/ui/` | Shared display helpers (file-size formatting, display names) |
| `translations.json` | Source of all user-facing labels |

### UX principles

The send/receive UX has two intentional, non-obvious behaviors — preserve them unless a task explicitly changes them:

- **Send is auto-generate-first**: ticket generation fires immediately on file selection (or ~800ms debounce for text). There is no "Send" button — the share card with QR/copy/native-share appears automatically.
- **Receive is paste-and-go**: receive is optimized for clipboard paste or QR scan → explicit CTA → immediate progress. Clipboard import, QR scan, remembered output path, and incremental progress are all part of the intended flow.

Incoming nearby/cloud transfers surface in two places simultaneously: an inline cue inside `TransferTab` and a blocking modal in `app/src/routes/index.tsx`.

### Styling

- Stack: SolidJS + DaisyUI + Tailwind CSS v4.
- Transfer surfaces use `rounded-2xl` / `rounded-3xl`, soft borders, compact action rows.
- Feedback primitives: toast (`solid-sonner`) + inline status card + blocking modal. Don't introduce new notification systems.
- Icons: `lucide-solid`.

## Async & Concurrency Patterns

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

## TypeScript/SolidJS Conventions

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { send_file, type SendFileRequest } from "~/lib/commands";

// Explicit types for signals
const [devices, setDevices] = createSignal<NearbyDevice[]>([]);

// Path aliases use ~/* for src/
```

## Repo-Specific Conventions

- Use `CommonConfig.temp_dir` on sandboxed platforms instead of assuming the current directory. This matters for Android/macOS temp storage and file import/export flows.
- Android file picking is URI-based, not normal-path-based. The Tauri backend copies `content://` URIs into temp files before sending and writes received files back through the Android FS plugin.
- Do not add `browser-lib` to the root Cargo workspace.
- The two Solid frontends serve different runtimes: `app/` is the Tauri UI, `browser/` is the Cloudflare web app. Similar-looking UI code in one does not imply shared state or shared build configuration with the other.
- For Tauri commands, convert Rust errors to `String` for the frontend (for example, `map_err(|e| format!("Failed to send: {}", e))?`).
- **iOS mDNS limitation**: iOS cannot publish mDNS services without the `com.apple.developer.networking.multicast` entitlement, which requires an Apple Developer Program membership. On personal-team signing, iOS can receive nearby broadcasts but other devices may not see it. This is a platform limit, not a code bug.

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

### Authentication (better-auth)

The Tauri app authenticates via the browser app's better-auth instance using system-browser OAuth + deep links. No compile-time keys are required in the Tauri app.

iOS release build and install:

```bash
cd app/src-tauri/gen/apple
xcodegen generate
nohup xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios -allowProvisioningUpdates -allowProvisioningDeviceRegistration CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=UJ8NW4N779 build > /tmp/xcodebuild.log 2>&1 &
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
xcrun devicectl device process launch --terminate-existing --device <device-id> io.sendme.app
```

- Prefer direct `xcodebuild` over `pnpm run tauri ios build` in this repo; the latter can fail during archive/export by reintroducing unsupported entitlements for personal-team signing.
- **First-time setup**: Before running `xcodebuild` on a new machine, open the project once in Xcode GUI (`open app/src-tauri/gen/apple/app.xcodeproj`), select the app_iOS target → Signing & Capabilities, and confirm the Team is set. Otherwise `xcodebuild` fails with "No Accounts" because the daemon cannot access credentials that haven't been unlocked by the GUI.
- **Empty entitlements**: `app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements` must remain empty (`<dict></dict>`) for personal-team signing.
- **Safari Web Inspector**: Set `SENDME_IOS_INSPECTOR=1` before building to enable Safari DevTools on the iOS WebView. This toggles the `ios-web-inspector` feature in `app/src-tauri/Cargo.toml`.
- **Background builds**: iOS builds take 10–12 minutes (warm cache). Use `nohup` as shown above and monitor with `tail -f /tmp/xcodebuild.log`; killing the terminal mid-link leaves a stale build.

### Auth Flow (System Browser + Deep Link)

The Tauri app uses system-browser OAuth instead of an in-app WebView:
1. Frontend calls `open_system_browser(url)` to open the browser app's OAuth page (`/auth/callback?mode=tauri`)
2. User authenticates via better-auth (GitHub, Google, or email/password) in the system browser
3. The browser callback page establishes a better-auth session, then reads the bearer token and deep-links back to the app (`sendme://auth/callback?token=...&user_id=...`)
4. `handle_auth_callback` in `lib.rs` extracts the token and user info, then emits `auth-callback-complete`
5. Frontend listens for `auth-callback-complete` and caches the bearer token for API/WebSocket auth

### Android Build Notes

- **`sodium_memcmp` crash on launch**: When cross-compiling Android on macOS, `libsodium-sys-stable` may produce an empty static library because the NDK's `llvm-ar` is not detected. This causes a runtime `UnsatisfiedLinkError`. The fix requires manually pre-building libsodium with the NDK toolchain and pointing `.cargo/config.toml` to it. See `ANDROID_DEBUG_GUIDE.md` for the full one-time setup.
- **`CHANGE_WIFI_MULTICAST_STATE` permission**: Required for iroh mDNS discovery on Android. Must be present in `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`.

### Platform-Specific File Picking

- **Android**: Uses `tauri_plugin_android_fs` for file/directory picking
- **iOS**: Uses `tauri_plugin_fs_ios` for Documents access, and a custom `tauri-plugin-media-picker` (Swift + Rust) for photo/video selection via `PHPickerViewController`
- **Desktop**: Uses `tauri_plugin_dialog`

## Environment Variables

- **`IROH_SECRET`**: Hex-encoded 32-byte secret key (optional, generates random if not set)
- **`SENDME_RELAY_URL`**: Custom iroh relay URL. When set, overrides the default n0 relay for CLI, Tauri remote transfers, and the browser WASM node
- **`IROH_FORCE_STAGING_RELAYS`**: Set to `1` to use staging relays (CI tests)
- **`RUST_LOG`**: Tracing level (debug, info, warn, error)
- **`RUSTFLAGS=-Dwarnings`**: Treat all warnings as errors (CI)
- **`SENDME_IOS_INSPECTOR=1`**: Enable Safari Web Inspector on the iOS WebView
- **`BETTER_AUTH_SECRET`**: better-auth secret for session signing (browser backend)
- **`GITHUB_CLIENT_ID`** / **`GITHUB_CLIENT_SECRET`**: GitHub OAuth credentials (browser backend)
- **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`**: Google OAuth credentials (browser backend)

## MSRV

Minimum Supported Rust Version: **1.81**

## Additional Documentation

- **`docs/ios-build-install.md`**: Full iOS build, install, and troubleshooting guide (device pairing, provisioning, logs)
- **`ANDROID_DEBUG_GUIDE.md`**: Step-by-step Android debugging workflow and the `libsodium` cross-compile fix
- **`ANDROID_FIX_SUMMARY.md`**: Details on Android temp directory fixes
- **`docs/nearby-discovery.md`**: mDNS service naming and iOS multicast entitlement limitations
