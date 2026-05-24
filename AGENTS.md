# Repository Guidelines

## Project Overview

Sendme is a **cross-platform P2P file transfer system** built on [iroh](https://iroh.computer). It supports direct peer-to-peer file and text transfers via `BlobTicket`s, local-network discovery (mDNS/Bonjour), and cloud-backed cross-device sync.

There are **four distinct products** in this repo:

| Product | Location | Technology | Targets |
|---------|----------|------------|---------|
| Core library | `lib/` | Rust (`sendme-lib`) | CLI, Tauri, WASM |
| CLI / TUI | `cli/` | Rust (`ratatui`, `clap`) | Linux, macOS, Windows |
| Desktop / Mobile app | `app/` + `app/src-tauri/` | Tauri 2 + SolidJS | Desktop + Android + iOS |
| Browser app | `browser/` + `browser-lib/` | SolidStart / Vinxi + WASM | Cloudflare Workers |

## Architecture & Data Flow

### High-Level Structure

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI/TUI   │     │ Tauri App   │     │ Browser App │     │  Core Lib   │
│   (cli/)    │     │ (app/)      │     │ (browser/)  │     │   (lib/)    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                    │                   │
       └───────────────────┴────────────────────┘                   │
                           │                                        │
                    sendme-lib (P2P engine)                ┌────────┴────────┐
                           │                               │                 │
                    ┌──────┴──────┐                   nearby/         progress.rs
                    │             │                  (mDNS/QUIC)    (event channels)
               send.rs        receive.rs
            (import +      (download +
             provider)        export)
```

### Data Flow: Send

1. `sendme-lib::send::send()` imports file/dir into iroh `FsStore` (`import.rs`)
2. Creates a `BlobTicket` containing the hash and endpoint addresses
3. Spawns an iroh `Router` kept alive with `std::future::pending()` — **never drop this**
4. Emits `ProgressEvent`s via `tokio::sync::mpsc::channel(32)`

### Data Flow: Receive

1. Parse `BlobTicket` → extract hash and endpoint info
2. Connect to provider via iroh `Endpoint`
3. Download to temp directory, verify via blake3 hashes
4. Export to filesystem (`export.rs`)
5. Clean up temp directory

### Cloud Sync Flow (Browser App)

```
Browser UI  ↔  SolidStart API routes  ↔  Cloudflare D1 (SQLite)
     ↕                    ↕
WebSocket  ←→  UserDO (Durable Object)  ←→  Other devices
```

- `UserDO` (`browser/src/worker/durable-objects/user.ts`) is a per-user Durable Object managing WebSocket pools, device presence, pending tickets, and friend list broadcasts.
- WebSocket endpoint: `/api/ws?deviceId=...&token=...`
- The `cloudflareWsBypassPlugin` in `browser/app.config.ts` is **essential** — without it, Nitro's h3 response reconstruction drops Cloudflare's special `webSocket` property and Durable Object handshakes fail.

### Cloud Sync Flow (Tauri App)

1. Authenticates against browser app's better-auth instance via OAuth + deep link (`sendme://auth/callback`)
2. REST client (`reqwest`) with `Authorization: Bearer <token>` and `X-Device-Id` headers
3. WebSocket loop with exponential backoff reconnect (1s → 30s cap) and 30s heartbeat
4. Commands: `login`, `devices`, `friends`, `send --to-device`, `send --to-friend`

### Auth Architecture

Both Tauri and browser apps authenticate against the **same better-auth instance** hosted on the browser app's Cloudflare backend:

- **Tauri**: OAuth system browser → deep link callback → cache bearer token
- **Browser**: better-auth session cookie + custom `/api/auth/token` endpoint for WebSocket auth
- **CLI**: API key auth (`sk_*` prefix), keys SHA-256 hashed in `api_keys` table

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `lib/` | Core P2P transfer engine (`sendme-lib` crate). Send, receive, import, export, progress events, nearby discovery. |
| `cli/` | `sendme` CLI binary + ratatui TUI. Cloud connectivity, config management. |
| `app/` | Tauri 2 frontend (SolidJS + Vite). `src/` = UI code, `src-tauri/src/lib.rs` = command handlers (~5,000 lines). |
| `browser/` | SolidStart web app (Cloudflare Workers). `src/routes/api/` = REST + WebSocket, `src/worker/durable-objects/` = UserDO. |
| `browser-lib/` | **Standalone WASM crate** (separate workspace). In-memory iroh node for browser P2P. |
| `packages/` | Shared packages: `shared` (types), `ui` (components), `config` (tsconfig). |
| `tests/` | Root-level Rust integration tests (CLI send/recv workflows). |
| `docs/` | Platform guides (iOS build, nearby discovery, Android debugging). |
| `patches/n0-snafu/` | Local crates.io patch fixing `color-backtrace` incompatibility. |

## Development Commands

### Rust Workspace

```bash
# Build
cargo build --release
cargo build -p sendme-lib              # Library only
cargo build -p cli                     # CLI binary only (bin name: sendme)
cargo run -p cli                       # Run TUI directly
cargo build -p app                     # Tauri Rust backend only

# Format & lint
cargo fmt --all
cargo clippy --locked --workspace --all-targets --all-features

# Test
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

**Android:**
```bash
cd app && pnpm run tauri android build
```

**iOS:**
Prefer direct `xcodebuild` + `devicectl` over `pnpm run tauri ios build`. The Tauri archive/export path can reintroduce unsupported entitlements for personal-team signing.

```bash
cd app/src-tauri/gen/apple
xcodegen generate

# Background build (use nohup so it survives terminal close)
nohup xcodebuild \
  -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release \
  -derivedDataPath build-ios -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=UJ8NW4N779 \
  build > /tmp/xcodebuild.log 2>&1 &

# Install and launch
xcrun devicectl device install app --device <device-id> \
  "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
xcrun devicectl device process launch --terminate-existing --device <device-id> io.sendme.app
```

## Code Conventions & Common Patterns

### Rust

- **`cargo fmt --all` is required before commit.**
- Use `tokio::sync::RwLock`, NOT `std::sync::RwLock`, for async shared state.
- Use `tokio::sync::mpsc::channel(32)` for progress events, `tokio::sync::oneshot::channel()` for cancellation.
- Convert Rust errors to `String` for Tauri frontend consumption:
  ```rust
  .map_err(|e| format!("Failed to send: {}", e))?
  ```
- Path safety: always use `canonicalized_path_to_string()` from `sendme-lib` instead of manual path string conversion.
- The sender's iroh `Router` must never be dropped. Keep it alive forever:
  ```rust
  tokio::spawn(async move {
      let _router = router;
      std::future::pending::<()>().await;
  });
  ```
- Android apps run in a sandbox where `std::env::current_dir()` is blocked. Always pass an explicit temp directory:
  ```rust
  let base_dir = args.common.temp_dir.as_ref().cloned()
      .unwrap_or_else(|| std::env::current_dir()?);
  ```
- Select with cancellation:
  ```rust
  tokio::select! {
      _ = cancel_rx.recv() => return,
      result = async_operation() => result?,
  }
  ```

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

## Important Files

| File | Purpose |
|------|---------|
| `Cargo.toml` | Root workspace manifest. Members: `lib`, `cli`, `app/src-tauri`. **Never add `browser-lib` to root workspace.** |
| `pnpm-workspace.yaml` | pnpm workspace: `app`, `browser`, `packages/*` |
| `lib/src/lib.rs` | Library entry point, re-exports, `get_or_create_secret()`, `canonicalized_path_to_string()` |
| `lib/src/send.rs` | Import + create ticket + keep router alive |
| `lib/src/receive.rs` | Connect by ticket + download + export |
| `lib/src/progress.rs` | `ProgressEvent`, `ProgressSenderTx`, `ProgressReceiverRx` types |
| `lib/src/types.rs` | `CommonConfig`, `SendArgs`, `ReceiveArgs`, `SendResult`, `ReceiveResult` |
| `lib/src/nearby/` | mDNS/Bonjour discovery + direct QUIC transfer |
| `cli/src/main.rs` | CLI argument parsing, TUI entry, cloud commands |
| `cli/src/tui/` | ratatui interactive UI |
| `app/src-tauri/src/lib.rs` | All Tauri command handlers, transfer registry, progress events, platform logic (~5,000 lines) |
| `app/src/app.tsx` | Tauri frontend app root |
| `browser/src/app.tsx` | Browser frontend app root |
| `browser/src/routes/api/ws.ts` | WebSocket upgrade handler |
| `browser/src/worker/durable-objects/user.ts` | UserDO real-time hub |
| `browser/app.config.ts` | Vinxi config with `cloudflareDoExportsPlugin` and `cloudflareWsBypassPlugin` |
| `browser-lib/src/node.rs` | In-memory iroh node for browser P2P |
| `tests/cli.rs` | CLI integration tests |
| `.github/workflows/release.yml` | CI release builds for CLI + Tauri + Android |

## Runtime/Tooling Preferences

| Layer | Runtime / Tool | Version / Constraint |
|-------|---------------|----------------------|
| Rust | `rustc` | MSRV 1.81 |
| Rust async | `tokio` | 1.34 |
| Rust P2P | `iroh` | 0.97, `iroh-blobs` 0.99 |
| Rust app shell | `tauri` | 2.x |
| JS runtime | Node.js | >= 22 (required for browser) |
| Package manager | `pnpm` | **Use for ALL JS/TS operations. NOT npm or yarn.** |
| Frontend framework | `solid-js` | 1.9.x |
| Full-stack framework | `@solidjs/start` + `vinxi` | browser app only |
| Styling | `tailwindcss` v4 + `daisyui` 5 | |
| Auth | `better-auth` | browser + Tauri |
| ORM | `drizzle-orm` + `drizzle-kit` | D1 SQLite |
| Deployment | `wrangler` | Cloudflare Workers |
| WASM bindgen | `wasm-bindgen` | **pinned to exactly 0.2.114** |
| macOS WASM compiler | LLVM Clang (`/opt/homebrew/opt/llvm/bin/clang`) | NOT Apple Clang |

### Build Constraints

- `browser-lib` has its own `[workspace]` in `Cargo.toml` — build separately with `--target=wasm32-unknown-unknown`.
- `[patch.crates-io] n0-snafu = { path = "patches/n0-snafu" }` fixes a `color-backtrace` incompatibility; do not remove.
- `app/src-tauri/Cargo.toml` has platform-specific deps: `tauri-nspanel` (macOS), `tauri-plugin-android-fs` + `jni` (Android), `tauri-plugin-fs-ios` + `objc2` (iOS).
- iOS: `app_iOS.entitlements` must stay empty (`<dict></dict>`) for personal-team signing.
- Set `SENDME_IOS_INSPECTOR=1` before building to enable Safari DevTools on iOS WebView.

## Testing & QA

### Rust Tests

- **Framework**: Built-in Rust test harness (`#[test]`, `#[tokio::test]`).
- **Integration tests**: `tests/cli.rs` — spawns the `sendme` binary, sends a file/dir, receives it, verifies content. No mocks; uses real iroh networking with staging relays (`IROH_FORCE_STAGING_RELAYS=1`).
- **Running**:
  ```bash
  cargo test --locked --workspace --all-features
  cargo test --test cli                    # CLI integration only
  cargo test send_recv_file                # Specific test
  ```
- There are no explicit coverage requirements, but the CLI integration test is the critical smoke test for the core transfer path.

### TypeScript Tests

- **Framework**: Vitest (both `app/` and `browser/`).
- **App tests** (`app/tests/`):
  - `cloud-api.test.ts` — Tests cloud API client with mocked Tauri HTTP plugin (`vi.mock("@tauri-apps/plugin-http")`).
  - `auth-session.test.ts` — Auth session handling.
- **Browser tests** (`browser/tests/`):
  - `auth.test.ts` — Auth helpers with mocked `~/lib/auth-server`.
  - `devices.test.ts` — Device management helpers.
- **Running**:
  ```bash
  cd app && pnpm test                    # All app tests
  cd browser && pnpm test                # All browser tests
  pnpm test -- <path-or-pattern>         # Specific file or pattern
  ```

### CI / CD

Releases trigger on `v*` tag pushes via `.github/workflows/release.yml`:

1. **CLI binaries** — Linux (x86_64), macOS (x86_64 + ARM64), Windows (x86_64 + ARM64).
2. **Tauri desktop apps** — macOS (ARM64 + Intel), Linux (Ubuntu 22.04), Windows.
3. **Android APK/AAB** — Built on Ubuntu with NDK 27.0.12077973; requires `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64` secrets.

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
