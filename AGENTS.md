# Sendme — Agent Guide

This file is written for AI coding agents who need to work in this repository. It describes the actual project structure, build/test processes, conventions, and gotchas you are most likely to hit. When instructions here conflict with generic assumptions, follow this file.

## Project Overview

Sendme is a cross-platform peer-to-peer file-transfer product built on top of [iroh](https://github.com/n0-computer/iroh). It supports four distinct products in a single monorepo:

| Product | Location | Purpose |
| --- | --- | --- |
| Core library | `lib/` | Shared Rust transfer engine (`sendme-lib`) |
| CLI / TUI | `cli/` | Terminal app with ratatui and command-line subcommands |
| Tauri app | `app/` + `app/src-tauri/` | SolidJS frontend + Rust backend for desktop and mobile |
| Browser app | `browser/` + `browser-lib/` | Cloudflare/SolidStart web app with a Rust/WASM node |

The highest-value frontend area for day-to-day AI work is the **Tauri app in `app/`**: a SolidJS UI over a Rust backend in `app/src-tauri/`.

Critical user journeys to preserve:
- Share a file quickly (auto-generate ticket on selection).
- Receive from a pasted or scanned ticket.
- Handle incoming nearby/cloud transfers without confusion.
- Preserve progress, history, and cross-device affordances.

## Repository Structure

```
sendme-app/
├── Cargo.toml              # Root Cargo workspace (lib, cli, app/src-tauri)
├── pnpm-workspace.yaml     # pnpm workspace: app, browser, packages/*
├── package.json            # Root package.json (thin, mostly peer deps)
├── lib/                    # sendme-lib: core send/receive/nearby logic
├── localsend/              # Vendored LocalSend protocol crate (from localsend/packages/core)
├── cli/                    # sendme binary: TUI + CLI commands
├── app/                    # Tauri SolidJS frontend
│   ├── src/                # SolidJS/TypeScript UI
│   ├── src-tauri/          # Rust Tauri backend
│   │   ├── src/lib.rs      # Main command handlers and runtime state
│   │   ├── src/menubar.rs  # Desktop system tray
│   │   ├── src/android.rs  # Android JNI helpers
│   │   └── plugins/        # Custom Tauri plugins (media picker)
│   └── tests/              # Vitest unit tests
├── browser/                # SolidStart/Vinxi web app (Cloudflare Workers)
│   ├── src/routes/api/     # Server API routes
│   ├── src/lib/db/         # Drizzle/D1 schema
│   ├── src/worker/         # Durable Objects
│   └── src/wasm/           # Generated WASM artifacts from browser-lib
├── browser-lib/            # Separate Cargo workspace for WASM bindings
├── packages/shared/        # Shared i18n string exports
├── packages/ui/            # Shared display helpers and small components
├── packages/config/        # Shared TS config references
├── tests/cli.rs            # CLI integration tests
└── translations.json       # Source of truth for UI labels
```

`browser-lib/` is intentionally **not** in the root Cargo workspace because its dependencies are not WASM-compatible with the main workspace.

## Technology Stack

### Rust
- **MSRV**: 1.81
- **Workspace members**: `lib`, `cli`, `app/src-tauri`, `peersync`, `localsend` (vendored)
- **Key crates**: `iroh` 1.0.0-rc.1, `iroh-blobs` 0.102.0, `tokio`, `anyhow`, `serde`, `tauri` 2.x
- **Release profile**: `panic = "abort"`, `opt-level = "s"`, `lto = true`, `codegen-units = 1`

### JavaScript / TypeScript
- **Package manager**: `pnpm` everywhere
- **Node**: 22+ required for `browser/`
- **Frontend frameworks**: SolidJS 1.9.x, SolidStart/Vinxi in browser, Vite in Tauri app
- **Styling**: Tailwind CSS v4 + DaisyUI, `lucide-solid` icons
- **State**: SolidJS signals/stores; Tauri app uses `GlobalStore` in `app/src/lib/store.tsx`

### Cloud / Browser
- **Runtime**: Cloudflare Workers (SolidStart/Vinxi `cloudflare_module` preset)
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Real-time**: Durable Object `UserDO` + WebSocket (`/api/ws`)
- **Auth**: better-auth with GitHub/Google OAuth
- **WASM**: `browser-lib` compiled to `wasm32-unknown-unknown` with `wasm-bindgen`

### Mobile
- **iOS/Android**: Tauri v2 mobile build
- **iOS media picker**: custom `tauri-plugin-media-picker`
- **Android file handling**: `tauri-plugin-android-fs`, `content://` URI copying

## Architecture & Data Flow

### Shared transfer core (`lib/`)

`sendme-lib` is the protocol and transfer layer used by CLI and Tauri.

| Module | Role |
| --- | --- |
| `lib/src/send.rs` | Import files into `FsStore`, build iroh endpoint, create `BlobTicket`, keep router alive |
| `lib/src/receive.rs` | Parse ticket, connect, download missing blobs, export to destination |
| `lib/src/import.rs` / `export.rs` | Filesystem ↔ blob-store conversion |
| `lib/src/progress.rs` | Transfer progress event types |
| `lib/src/types.rs` | Shared request/config types (`CommonConfig`, `SendArgs`, `ReceiveArgs`) |
| `lib/src/nearby/` | LocalSend-protocol nearby runtime (discovery, send/receive wrapper) |

The cross-product transfer contract is an `iroh_blobs::ticket::BlobTicket` using collection/`HashSeq` data so filenames and directory structure survive across CLI, Tauri, and browser flows.

### Tauri app (`app/`)

Split cleanly between SolidJS frontend and Rust backend.

- **Frontend shell**: `app/src/routes/index.tsx` owns tabs, nav, persistence, nearby/cloud modals, and event subscriptions.
- **Primary workspace**: `app/src/components/TransferTab.tsx` switches modes (`send` / `receive` / `text`) and alternate channels (`nearby` / `devices` / `friends`).
- **Send flow**: `DropZone`/`SendPanel` → `GlobalStore` → `app/src/bindings.ts` → `send_file` / `send_text` command → backend. Ticket is generated immediately on file selection or after ~800 ms debounce for text.
- **Receive flow**: `ReceivePanel` → paste/scan ticket → `receive_file` command → progress events on Tauri `progress` channel → `TransferProgress` UI.
- **Backend state**: `app/src-tauri/src/lib.rs` contains command handlers, in-memory transfer registry (`Arc<RwLock<HashMap<String, TransferState>>>`), progress emission, nearby runtime, cloud state, and mobile-specific file handling.
- **Auth**: system-browser OAuth via deep link (`sendme://auth/callback?token=...`). No compile-time auth keys in the Tauri app.

### Browser app (`browser/`)

A separate SolidStart/Cloudflare product.

- **Client UI**: `browser/src/routes/app/`, `browser/src/components/sendme/`
- **Server routes**: `browser/src/routes/api/`
- **Database**: `browser/src/lib/db/schema.ts` defines D1 tables for users, sessions, devices, tickets, transfers, friends, and API keys.
- **Real-time hub**: `browser/src/worker/durable-objects/user.ts` manages device presence, pending tickets, and friend updates.
- **WASM bridge**: `browser/src/lib/commands.ts` lazily loads the `browser-lib` WASM module and exposes browser-friendly send/receive helpers.

Two custom Rollup plugins in `browser/app.config.ts` are required for Cloudflare deployment:
- `cloudflareDoExportsPlugin` injects the `UserDO` named export for Wrangler binding.
- `cloudflareWsBypassPlugin` intercepts `/api/ws` upgrades before Nitro reconstructs the Response, preserving Cloudflare's `webSocket` property for Durable Object handshakes.

## Development Commands

### Rust workspace

```bash
cargo build
cargo build --release
cargo build -p sendme-lib
cargo build -p cli                 # builds the sendme binary
cargo build -p app                 # builds the Tauri Rust backend

cargo test --locked --workspace --all-features
cargo test -p sendme-lib
cargo test --test cli              # CLI integration tests
cargo test send_recv_file
IROH_FORCE_STAGING_RELAYS=1 cargo test --locked --workspace --all-features

cargo fmt --all
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features
```

### Tauri app

```bash
cd app
pnpm install
pnpm run dev              # Vite frontend only
pnpm run build            # frontend build only
pnpm run tauri dev        # Tauri shell + frontend
pnpm run tauri build      # production desktop app
pnpm run tauri android build
pnpm run format           # prettier --write src
pnpm test                 # vitest
pnpm test -- <pattern>    # single test file/name
```

### Browser app

```bash
cd browser
pnpm install
pnpm run build:wasm          # rebuild browser-lib into browser/src/wasm
pnpm run build:wasm:release
pnpm run dev                 # Vinxi dev server
pnpm run dev:cf              # wrangler dev on built output
pnpm run build
pnpm run preview
pnpm run deploy              # npm run build && wrangler deploy
pnpm run deploy:cf           # production deploy with minify
pnpm run db:generate
pnpm run db:migrate
pnpm run db:migrate:prod
pnpm run db:studio
pnpm test
pnpm test -- <pattern>
```

### Browser WASM crate (`browser-lib/`)

```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # macOS: use llvm clang, not Apple clang
cargo build --target=wasm32-unknown-unknown
cargo build --target=wasm32-unknown-unknown --release
```

## Code Conventions & Style Guidelines

### Rust
- Format with `cargo fmt --all`.
- Lint with `cargo clippy --locked --workspace --all-targets --all-features`.
- Use `tokio::sync::RwLock` for async shared state, never `std::sync::RwLock`.
- Use `tokio::sync::mpsc::channel(32)` for progress streams and `tokio::sync::oneshot::channel()` for cancellation.
- Tauri backend errors must cross the boundary as `String` (`map_err(|e| format!("...", e))?`).
- Keep the sender router alive with `std::future::pending::<()>().await`. Dropping the router breaks incoming connections; never replace with a sleep loop.
- Use `CommonConfig.temp_dir` on sandboxed platforms (Android/iOS) instead of assuming the current directory.

### TypeScript / SolidJS
- Use `pnpm` for all JS/TS work.
- Use `~/*` path aliases for local imports inside `app/` and `browser/`.
- Type signals explicitly when the type matters.
- Put shared transfer state in `GlobalStore`; do not duplicate per-panel state.
- Route Tauri backend calls through `app/src/bindings.ts`; avoid raw `invoke()` scattered through components.
- External packages first, then local imports.

### Styling (Tauri app)
- Stack: SolidJS + DaisyUI + Tailwind CSS v4.
- Transfer surfaces use `rounded-2xl` / `rounded-3xl`, soft borders, and compact action rows.
- Feedback primitives: toast (`solid-sonner`) + inline status card + blocking modal. Do not invent new notification systems.
- Icons: `lucide-solid`.

### Repo-specific conventions
- Do not add `browser-lib/` to the root Cargo workspace.
- Treat `app/` and `browser/` as separate SolidJS runtimes; code from one does not apply to the other.
- `translations.json` is the source of truth for user-facing labels; prefer it over hard-coding strings.
- Preserve the two custom Rollup plugins in `browser/app.config.ts` when modifying the browser build.

## Testing Strategy

### Rust
- Unit tests live in crate source files (e.g., `lib/src/lib.rs`).
- CLI integration tests live in `tests/cli.rs` and exercise the compiled `sendme` binary via `duct`.
- Run with `IROH_FORCE_STAGING_RELAYS=1` in CI to use iroh staging relays.

### Tauri frontend
- Uses Vitest in a Node environment.
- `app/tests/setup.ts` installs `localStorage`, `crypto.randomUUID`, and `window` shims.
- Current automated tests:
  - `app/tests/auth-session.test.ts`
  - `app/tests/cloud-api.test.ts`
  - `app/tests/transfer-ui.test.ts`
- There is no component-level coverage for the send/receive UX; manual validation in the Tauri shell is required.

### Browser app
- `browser/src/lib/composables/deviceRegistration.test.ts` exists as a starting point.
- Run with `cd browser && pnpm test`.

### Minimum manual QA for share/receive changes
1. Desktop file selection via `DropZone`.
2. Auto ticket generation after file select.
3. Copy/share actions from the generated ticket card.
4. Ticket paste from clipboard in receive mode.
5. Destination folder selection persistence.
6. Progress updates, speed, ETA, and cancel action during receive.
7. Nearby incoming request modal accept/decline flow.
8. History re-share flow from `HistoryPanel`.
9. Mobile-only affordances if touched: QR scan, share sheet, picker behavior.

## Security Considerations

- **End-to-end encryption**: Transfers use TLS; content is verified with blake3 streaming.
- **No central file server**: P2P transfers do not require a central cloud storage provider.
- **Ticket-based sharing**: `BlobTicket` contains endpoint addresses + content hash; keep tickets private to intended recipients.
- **Path traversal protection**: `lib/src/lib.rs` validates path components before exporting received files (`validate_path_component`, `get_export_path`).
- **API keys**: Browser app stores SHA-256 hashes of CLI API keys; the full key is shown only once at creation.
- **OAuth secrets**: GitHub/Google client secrets live only in the browser backend (`wrangler.jsonc`); the Tauri app has no compile-time auth keys.
- **Deep link token**: The Tauri app receives bearer tokens via `sendme://` deep links; the frontend caches them for API/WebSocket auth.
- **CSP**: Tauri config sets `csp: null`; be cautious when adding external resource loading.

## Deployment & Release Process

Releases are driven by Git tags (`v*`) via `.github/workflows/release.yml`.

### What the workflow builds
1. **CLI binaries** for Linux, macOS (x86_64 + aarch64), and Windows (x86_64 + aarch64).
2. **Tauri desktop installers** for macOS ARM64/AMD64, Linux, and Windows.
3. **Android APK/AAB** if Android signing secrets (`ANDROID_KEY_*`) are configured; otherwise the job skips.

### Artifacts uploaded to the GitHub release
- `sendme-cli-vVERSION-<target>.tar.gz` / `.zip`
- Tauri bundle outputs per platform
- Android APKs per ABI and AAB
- `dist/checksums.txt`

### Mirror step
CLI archives and Android APKs/AABs are mirrored to `sternelee/sendme-mirror` if `PUBLIC_REPO_PAT` is set.

### Manual iOS release
Prefer direct `xcodebuild` over `pnpm run tauri ios build` in this repo:

```bash
cd app/src-tauri/gen/apple
xcodegen generate
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

tail -f /tmp/xcodebuild.log

xcrun devicectl device install app \
  --device <device-id> \
  "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"

xcrun devicectl device process launch \
  --terminate-existing \
  --device <device-id> \
  io.sendme.app
```

See `docs/ios-build-install.md` for full details.

### Browser deployment
```bash
cd browser
pnpm run deploy:cf
```

## Critical Gotchas

- **Router keep-alive (CRITICAL)**: The sender's router must stay alive with `std::future::pending().await`. Dropping it breaks incoming connections.
- **Android temp directory**: Always use `CommonConfig.temp_dir` on Android. Apps are sandboxed; assuming the current directory breaks file import/export.
- **browser-lib is a separate workspace**: Do not add it to the root `Cargo.toml` workspace.
- **app/ and browser/ are separate products**: Both use SolidJS but share no state or build configuration.
- **iOS first-time Xcode setup**: Before `xcodebuild` on a new machine, open the project in Xcode GUI once and confirm the Team. The daemon cannot access credentials without this.
- **iOS entitlements**: `app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements` must remain empty (`<dict></dict>`) for personal-team signing.
- **iOS multicast limitation**: Nearby uses the LocalSend protocol (UDP multicast announcements + HTTPS transfers). Without the `com.apple.developer.networking.multicast` entitlement (unavailable to personal teams), iOS cannot receive multicast announcements, so nearby discovery of other devices is limited. HTTPS serving and outbound registration still work. This is a platform limit, not a code bug.
- **Recursion limit**: If you hit "recursion limit reached" compiling `app/src-tauri/src/lib.rs`, add `#![recursion_limit = "256"]` at the top.
- **Android sodium_memcmp crash**: Cross-compiling Android on macOS can produce an empty libsodium static library. See `ANDROID_DEBUG_GUIDE.md` for the one-time NDK fix.
- **CI tests require staging relays**: Run `IROH_FORCE_STAGING_RELAYS=1` before `cargo test` in CI.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `IROH_SECRET` | Hex-encoded 32-byte secret key (optional, random if unset) |
| `SENDME_RELAY_URL` | Custom iroh relay URL; overrides default n0 relay |
| `IROH_FORCE_STAGING_RELAYS=1` | Use staging relays (CI tests) |
| `RUST_LOG` | Tracing level: `debug`, `info`, `warn`, `error` |
| `RUSTFLAGS=-Dwarnings` | Treat warnings as errors (CI) |
| `SENDME_IOS_INSPECTOR=1` | Enable Safari Web Inspector on iOS WebView |
| `BETTER_AUTH_SECRET` | better-auth session signing secret (browser backend) |
| `BETTER_AUTH_URL` | better-auth public URL (browser backend) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (browser backend) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (browser backend) |
| `CLOUDFLARE_D1_ID` / `CLOUDFLARE_KV_ID` | Local dev binding placeholders for browser app |

## Important Files

### Tauri app
| File | Why it matters |
| --- | --- |
| `app/src/routes/index.tsx` | Main UX shell: tabs, nav, persistence, nearby/cloud modals, event wiring |
| `app/src/components/TransferTab.tsx` | Main transfer workspace and share-channel switching |
| `app/src/components/SendPanel.tsx` | File/text share flow, auto ticket generation, QR/copy/share card |
| `app/src/components/ReceivePanel.tsx` | Ticket paste/scan flow, destination selection, progress display |
| `app/src/components/HistoryPanel.tsx` | Completed transfers, re-share affordance, open/delete actions |
| `app/src/lib/components/DropZone.tsx` | Desktop drag/drop + picker UX, mobile picker bridge |
| `app/src/lib/components/TransferProgress.tsx` | Shared progress card for receive/nearby transfers |
| `app/src/lib/components/IncomingRequestCard.tsx` | Accept/decline UI for nearby/cloud inbound transfers |
| `app/src/lib/components/FileManifest.tsx` | Compact file list used inside incoming transfer review |
| `app/src/lib/store.tsx` | Shared UI state for send/receive/nearby/cloud |
| `app/src/lib/auth.tsx` | Auth/session bridge for the Tauri UI |
| `app/src/lib/cloud-api.ts` | Cloud HTTP helpers; device ID and auth header handling |
| `app/src/bindings.ts` | Typed Tauri command wrappers used by the UI |
| `app/src-tauri/src/lib.rs` | Backend commands, event emission, nearby/cloud/mobile runtime |
| `app/src-tauri/src/menubar.rs` | Desktop system tray |

### Shared / CLI
| File | Why it matters |
| --- | --- |
| `lib/src/send.rs` | Core send logic; router keep-alive lives here |
| `lib/src/receive.rs` | Core receive/download logic |
| `lib/src/nearby/` | LocalSend protocol wrapper (runtime, identity, device types) |
| `cli/src/main.rs` | CLI entry point and TUI launcher |
| `cli/src/tui/` | ratatui TUI implementation |

### Browser app
| File | Why it matters |
| --- | --- |
| `browser/src/worker/durable-objects/user.ts` | Cloudflare Durable Object: real-time device presence and ticket hub |
| `browser/app.config.ts` | Custom Rollup plugins required for DO exports and WebSocket handshakes |
| `browser/src/lib/commands.ts` | JS bridge for the WASM node |
| `browser/src/lib/db/schema.ts` | D1 database schema |
| `browser/wrangler.jsonc` | Cloudflare Worker bindings and secrets |

### Other
| File | Why it matters |
| --- | --- |
| `translations.json` | Source of all user-facing labels |
| `Cargo.toml` | Root workspace definition and shared dependencies |
| `pnpm-workspace.yaml` | pnpm workspace definition |
| `.github/workflows/release.yml` | Release CI for CLI, desktop, and Android |

## Mobile Development Notes

### iOS
- Use `xcodegen` + `xcodebuild` + `devicectl` for release installs.
- First-time setup requires opening the Xcode project GUI once to confirm the Team.
- Keep `app_iOS.entitlements` empty (`<dict></dict>`) for personal-team signing.
- Set `SENDME_IOS_INSPECTOR=1` to enable Safari Web Inspector.
- iOS builds take 10–12 minutes; use `nohup` and monitor with `tail -f /tmp/xcodebuild.log`.

### Android
- The `sodium_memcmp` startup crash requires a one-time libsodium build with the NDK toolchain. See `ANDROID_DEBUG_GUIDE.md`.
- `CHANGE_WIFI_MULTICAST_STATE` permission must be present in `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- Android file picking returns `content://` URIs; the backend copies them into temp files before transfer.

### Platform-specific file picking
- **Android**: `tauri_plugin_android_fs`
- **iOS**: `tauri_plugin_fs_ios` for Documents, custom `tauri-plugin-media-picker` for photo/video
- **Desktop**: `tauri_plugin_dialog`

## Auth Flow (Tauri app)

The Tauri app authenticates via the browser app's better-auth instance using the system browser, not an in-app WebView:

1. Frontend calls `open_system_browser(url)` to open `/auth/callback?mode=tauri`.
2. User authenticates via better-auth (GitHub, Google, or email/password).
3. The browser callback page reads the bearer token and deep-links back: `sendme://auth/callback?token=...&user_id=...`.
4. `handle_auth_callback` in `app/src-tauri/src/lib.rs` extracts the token and emits `auth-callback-complete`.
5. Frontend listens for the event and caches the bearer token for API/WebSocket auth.

## Additional Documentation

- `README.md` — Human-facing overview, installation, and usage.
- `CLAUDE.md` — Additional Claude Code guidance with command reference and deep implementation notes.
- `docs/ios-build-install.md` — Full iOS build, install, and troubleshooting guide.
- `docs/nearby-discovery.md` — LocalSend nearby protocol architecture and platform limitations.
- `ANDROID_DEBUG_GUIDE.md` — Android `libsodium` cross-compile fix and debugging workflow.
- `ANDROID_FIX_SUMMARY.md` — Android temp directory fixes.
- `API_CONTRACT_REFERENCE.md` — API contract details.
- `WEBSOCKET_*.md` — WebSocket message protocol and analysis for the browser app.
