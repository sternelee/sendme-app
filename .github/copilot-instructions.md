# Sendme Copilot Instructions

Sendme is a multi-target P2P file transfer repo: Rust core + CLI, a Tauri SolidJS app, and a separate Cloudflare/SolidStart browser app with a WASM bridge.

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
