# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendme is a cross-platform P2P file transfer system built on `iroh`.

There are four distinct products in this repo:
- `lib/` — shared Rust transfer engine (`sendme-lib`)
- `cli/` — `sendme` terminal app and TUI
- `app/` + `app/src-tauri/` — Tauri desktop/mobile app with a SolidJS frontend
- `browser/` + `browser-lib/` — browser app plus WASM bindings

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

CLERK_PUBLISHABLE_KEY='pk_test_...' pnpm run tauri android build
CLERK_PUBLISHABLE_KEY='pk_test_...' pnpm run tauri ios build
```

### Browser app (`browser/`)

```bash
cd browser
pnpm install
pnpm run build:wasm         # rebuild browser-lib output into browser/src/wasm
pnpm run build:wasm:release
pnpm run dev
pnpm run build
pnpm run preview
pnpm run deploy:cf
pnpm run db:generate
pnpm run db:migrate
pnpm run db:migrate:prod
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

Nearby-device support crosses layers:
- protocol/discovery primitives are in `lib/src/nearby/*`
- the Tauri backend keeps a `NearbyRuntime` with the live endpoint, discovery instance, and pending approval state
- the frontend subscribes to backend events and renders nearby send/receive state from the global store

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
