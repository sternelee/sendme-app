# Sendme Copilot Instructions

Sendme is a multi-target P2P file transfer repo built on `iroh`: a Rust core + CLI, a Tauri/SolidJS desktop/mobile app, and a separate Cloudflare/SolidStart browser app with a WASM bridge.

**MSRV**: Rust 1.91. **Node**: 22+. **Package manager**: `pnpm` everywhere.

## Build, test, and lint

### Rust workspace
- `cargo build`
- `cargo build --release`
- `cargo build -p sendme-lib`
- `cargo build -p cli`
- `cargo build -p app`
- `cargo fmt --all`
- `cargo clippy --locked --workspace --all-targets --all-features`
- `cargo test --locked --workspace --all-features`
- `IROH_FORCE_STAGING_RELAYS=1 cargo test --locked --workspace --all-features`
- Single test / suite examples: `cargo test send_recv_file`, `cargo test --test cli`, `cargo test -p sendme-lib`

### Tauri app (`app/`)
- `cd app && pnpm install`
- `cd app && pnpm run dev`
- `cd app && pnpm run tauri dev`
- `cd app && pnpm run tauri build`
- `cd app && pnpm run format`
- `cd app && pnpm test`
- Single Vitest file / name: `cd app && pnpm test -- <path-or-pattern>`

### Browser app (`browser/`)
- `cd browser && pnpm install`
- `cd browser && pnpm run build:wasm`
- `cd browser && pnpm run build:wasm:release`
- `cd browser && pnpm run dev`
- `cd browser && pnpm run dev:cf`
- `cd browser && pnpm run build`
- `cd browser && pnpm run preview`
- `cd browser && pnpm run deploy:cf`
- `cd browser && pnpm run db:generate`
- `cd browser && pnpm run db:migrate`
- `cd browser && pnpm run db:migrate:prod`
- `cd browser && pnpm run db:studio`
- `cd browser && pnpm test`
- Single Vitest file / name: `cd browser && pnpm test -- <path-or-pattern>`

### Browser WASM workspace (`browser-lib/`)
- `cd browser-lib && export CC=/opt/homebrew/opt/llvm/bin/clang && cargo build --target=wasm32-unknown-unknown`
- `cd browser-lib && export CC=/opt/homebrew/opt/llvm/bin/clang && cargo build --target=wasm32-unknown-unknown --release`

## High-level architecture

- `lib/` is the shared transfer engine (`sendme-lib`): import/export, ticket generation, receive flow, progress events, and nearby discovery.
- `cli/` is the `sendme` binary and ratatui TUI; it delegates transfer work to `sendme-lib`.
- `app/` is the SolidJS frontend for Tauri; `app/src-tauri/src/lib.rs` holds the command handlers, transfer registry, progress events, and platform-specific mobile logic.
- `browser/` is a separate SolidStart/Cloudflare app; client UI lives under `browser/src/routes/app/`, server routes under `browser/src/routes/api/`, and the Durable Object hub is `browser/src/worker/durable-objects/user.ts`.
- `browser-lib/` is a separate Cargo workspace for the browser WASM node. Its generated bindings are consumed by `browser/src/lib/commands.ts`.

## Key conventions

- Keep the sender router alive in `lib/src/send.rs` with `std::future::pending()`. Dropping the router breaks incoming connections.
- Use `tokio::sync::RwLock` for async shared state, and `tokio::sync::mpsc::channel(32)` / `tokio::sync::oneshot::channel()` for progress and cancellation.
- Tauri backend errors should be converted to `String` before crossing the frontend boundary.
- On sandboxed platforms, use `CommonConfig.temp_dir`; Android file picking is URI-based (`content://`) and copied into temp files by the backend.
- Do not add `browser-lib` to the root Cargo workspace.
- Treat `app/` and `browser/` as separate runtimes. They both use SolidJS, but they do not share state or build assumptions.
- Use `pnpm` for all JavaScript/TypeScript work; `browser/package.json` requires Node 22+.
- For iOS release installs, prefer `xcodegen` + `xcodebuild` + `devicectl`; keep `app_iOS.entitlements` empty for personal-team signing.
- After changing browser WASM or Rust browser logic, rebuild generated artifacts with `cd browser && pnpm run build:wasm`.
- Preserve the Cloudflare worker plugins in `browser/app.config.ts`; they are required for Durable Object exports and WebSocket handshakes.
- In TS/Solid code, use `~/*` imports for local modules and type signals explicitly.
- **iOS mDNS limitation**: iOS cannot publish mDNS services without the `com.apple.developer.networking.multicast` entitlement (requires paid Apple Developer Program). On personal-team signing, iOS can receive nearby broadcasts but won't be discovered by other devices — this is a platform limit, not a code bug.
- If Tauri Rust compilation fails with "recursion limit reached", add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`.
- Set `SENDME_IOS_INSPECTOR=1` before building the iOS app to enable Safari Web Inspector on the WebView (toggles the `ios-web-inspector` feature in `app/src-tauri/Cargo.toml`).
- iOS builds take 10–12 minutes. Use `nohup xcodebuild ... > /tmp/xcodebuild.log 2>&1 &` and monitor with `tail -f /tmp/xcodebuild.log`.
- The browser WebSocket (`/api/ws`) passes the bearer token as a query parameter because browsers cannot set custom headers on WebSocket connections.

## UX principles (Tauri app)

The send/receive UX has two intentional, non-obvious behaviors — preserve them unless a task explicitly changes them:

- **Send is auto-generate-first**: ticket generation fires immediately on file selection (or ~800ms debounce for text). There is no "Send" button — the share card with QR/copy/native-share appears automatically.
- **Receive is paste-and-go**: receive is optimized for clipboard paste or QR scan → explicit CTA → immediate progress. Clipboard import, QR scan, remembered output path, and incremental progress are all part of the intended flow.

Incoming nearby/cloud transfers surface in two places simultaneously: an inline cue inside `TransferTab` and a blocking modal in `app/src/routes/index.tsx`.

## State ownership (Tauri app)

| Owner | What it holds |
| --- | --- |
| `app/src/lib/store.tsx` | Send/receive/nearby/cloud UI state |
| `app/src/lib/auth.tsx` | Auth/session state |
| `app/src/bindings.ts` | Typed boundary to the Rust backend (use this, not raw `invoke()`) |
| `app/src-tauri/src/lib.rs` | Transfer registry, event emission, nearby runtime, cloud state, mobile file handling |

## Important files

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

## Styling (Tauri app)

- Stack: SolidJS + DaisyUI + Tailwind CSS v4.
- Transfer surfaces use `rounded-2xl` / `rounded-3xl`, soft borders, compact action rows.
- Feedback primitives: toast (`solid-sonner`) + inline status card + blocking modal. Don't introduce new notification systems.
- Icons: `lucide-solid`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `IROH_SECRET` | Hex-encoded 32-byte secret key (random if unset) |
| `IROH_FORCE_STAGING_RELAYS=1` | Use staging relays; required for CI tests |
| `RUST_LOG` | Tracing level: `debug`, `info`, `warn`, `error` |
| `RUSTFLAGS=-Dwarnings` | Treat warnings as errors (CI) |
| `SENDME_IOS_INSPECTOR=1` | Enable Safari Web Inspector on iOS WebView |
| `BETTER_AUTH_SECRET` | Session signing secret (browser backend) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (browser backend) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (browser backend) |

## Auth flow (Tauri app)

Auth uses system-browser OAuth + deep links (no in-app WebView):
1. Frontend calls `open_system_browser(url)` to open the browser app's OAuth page.
2. User completes auth in the system browser (better-auth, GitHub or Google).
3. The callback page deep-links back to the app: `sendme://auth/callback?token=...&user_id=...`
4. `handle_auth_callback` in `lib.rs` extracts the token and emits `auth-callback-complete`.
5. Frontend listens for `auth-callback-complete` and caches the bearer token for API/WebSocket calls.
