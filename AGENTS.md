# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendmd is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendmd`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **WASM browser** - Experimental (separate build: `browser-lib/`)

### Cargo Workspace Structure

```
iroh-sendmd/
├── lib/                    # sendmd-lib - Core library (send/receive/nearby)
├── cli/                    # sendmd CLI - Binary using sendmd-lib
├── app/src-tauri/          # Tauri backend
└── browser-lib/            # WASM bindings (separate workspace - NOT in main workspace)
```

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Build, Lint, and Test Commands

### Rust Commands

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p sendmd-lib      # Library only
cargo build -p sendmd          # CLI only (binary name: sendmd)
cargo build -p app             # Tauri backend only

# Format (REQUIRED before committing)
cargo fmt --all

# Lint (warnings are errors in CI: RUSTFLAGS=-Dwarnings)
cargo clippy --locked --workspace --all-targets --all-features

# Check dependencies are correct
cargo check --workspace --all-features --bins
```

### Running Tests

```bash
# All workspace tests
cargo test --locked --workspace --all-features

# Run specific test by name
cargo test send_recv_file
cargo test send_recv_dir

# Test specific package
cargo test -p sendmd-lib                     # Library tests only
cargo test -p cli                            # CLI tests only

# Run integration tests only
cargo test --test cli                        # tests/cli.rs

# Run library unit tests only
cargo test --lib -p sendmd-lib

# Verbose output for debugging
cargo test send_recv_file -- --nocapture

# Run with staging relays (like CI)
IROH_FORCE_STAGING_RELAYS=1 cargo test
```

### Tauri App Commands

```bash
cd app
pnpm install                       # Install dependencies
pnpm run dev                       # Vinxi dev server on port 1420
pnpm run tauri dev                 # Dev with hot reload
pnpm run build                     # Build frontend (vinxi build)
pnpm run tauri build               # Build complete desktop app
pnpm run format                    # Prettier formatting

# Mobile builds
pnpm run tauri android build
pnpm run tauri android build --target aarch64
pnpm run tauri ios build
```

### Browser WASM Build (Separate - NOT in workspace)

```bash
cd browser-lib
# macOS: Use LLVM Clang (NOT Apple Clang)
export CC=/opt/homebrew/opt/llvm/bin/clang
cargo build --target=wasm32-unknown-unknown
cargo build --target=wasm32-unknown-unknown --release
```

## Code Style Guidelines

### Rust Import Order

Use ordered groups with blank lines between:

```rust
// 1. Standard library
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};

// 2. External crates (alphabetical)
use anyhow::Context;
use iroh::{Endpoint, RelayMode};
use iroh_blobs::{BlobFormat, BlobsProtocol};
use tokio::select;

// 3. Local crate imports
use crate::{progress::*, types::*};
```

### Rust Naming Conventions

- Types/Structs/Enums: `PascalCase` (`SendResult`, `NearbyDevice`, `AddrInfoOptions`)
- Functions/Methods: `snake_case` (`send_with_progress`, `get_or_create_secret`)
- Constants: `SCREAMING_SNAKE_CASE` (`MSRV`, `ALPN`, `TICK_RATE_MS`)
- Modules: `snake_case` (`send`, `receive`, `progress`)

### Rust Error Handling

```rust
// Use anyhow for application errors
anyhow::bail!("custom error message");
anyhow::ensure!(condition, "error message");
.context("additional context")?

// For Tauri commands: convert to String for frontend
.map_err(|e| format!("Failed to send: {}", e))?
```

### Rust Async Patterns

```rust
// Progress channels
tokio::sync::mpsc::channel::<ProgressEvent>(32)

// Abort signals
tokio::sync::oneshot::channel::<()>()

// Shared state - use tokio RwLock, NOT std::sync::RwLock
tokio::sync::RwLock<HashMap<String, State>>

// CRITICAL: Keep routers alive in async contexts
std::future::pending::<()>().await
```

### TypeScript/SolidJS Style

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { createSignal, createEffect } from "solid-js";
import { send_file, type SendFileRequest } from "~/lib/commands";

// Explicit types for signals
const [devices, setDevices] = createSignal<NearbyDevice[]>([]);
const [isLoading, setIsLoading] = createSignal<boolean>(false);

// SolidJS components use function components with TSX
// Props: type Props = { onClose: () => void; onUpdate: (value: string) => void }
// Import paths use ~/* alias for src/ (configured in tsconfig.json)
```

## Important Details

- **MSRV**: 1.81 (Minimum Supported Rust Version)
- **CI Environment**: `RUSTFLAGS: -Dwarnings` (all warnings are errors)
- **CI Environment**: `IROH_FORCE_STAGING_RELAYS: 1` (use staging relays in tests)
- **TypeScript**: Strict mode enabled (noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch)
- **Frontend Framework**: SolidJS (not Vue/React) with Vinxi bundler and Tailwind CSS v4
- **Path Handling**: All temp directories use `.sendmd-*` prefix
- **Nearby Discovery**: Uses mDNS, requires same WiFi network
- **Release Profile**: Optimized for size (`opt-level = "s"`, LTO, strip debug)

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send functionality (lib/src/send.rs)
2. **Browser WASM**: Never add `browser-lib` to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Android content URIs**: Handle `content://` URIs specially in Tauri (see `app/src-tauri/src/lib.rs`)
6. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`
7. **Android temp directories**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
8. **Recursion limit**: If compilation fails with "recursion limit reached", add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`
9. **Android JNI**: Always use `push_local_frame()`/`pop_local_frame()` in loops to prevent local reference overflow
10. **pnpm workspace**: References non-existent `tauri-plugin-mobile-file-picker` (legacy, can be ignored)

## Architecture Overview

### Core Library (`lib/`)

- **`lib.rs`**: Public API exports, `get_or_create_secret()` function
- **`send.rs`**: Send/host - creates endpoint, imports files, serves data, spawns keep-alive task
- **`receive.rs`**: Receive/download - connects, downloads via `execute_get()`, exports to filesystem
- **`import.rs`**: File/directory import into blob store (parallelized with `num_cpus`)
- **`export.rs`**: Export from blob store to filesystem
- **`progress.rs`**: Progress event types/channels (ImportProgress, ExportProgress, DownloadProgress, ConnectionStatus)
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`)

### Tauri App (`app/`)

**Frontend** (`app/src/`): SolidJS + Tailwind CSS v4. Key files:
- **`routes/index.tsx`**: Main UI (Send/Receive tabs, transfers list)
- **`bindings.ts`**: Type-safe Tauri command wrappers
- **`lib/utils.ts`**: Utilities (formatFileSize, formatDate)

**Backend** (`app/src-tauri/src/lib.rs`): Tauri commands wrapping `sendmd-lib`:
- `send_file`, `receive_file`, `cancel_transfer`, `get_transfers`, `get_transfer_status`
- `start_nearby_discovery`, `get_nearby_devices`, `stop_nearby_discovery`
- Uses `tokio::sync::RwLock<HashMap>` for transfer state
- Emits progress via `app.emit("progress", update)`

## File References

Use `path:line` format for code references (e.g., `lib/src/send.rs:42`).

## Environment Variables

- **`IROH_SECRET`**: Hex-encoded 32-byte secret key (optional, generates random if not set)
- **`IROH_FORCE_STAGING_RELAYS`**: Set to `1` to use staging relays (CI tests)
- **`RUST_LOG`**: Tracing level (debug, info, warn, error)

## Key Dependencies

**Rust**: `iroh` 0.95, `iroh-blobs` 0.97, `tokio` 1.34, `anyhow`, `clap`, `ratatui`, `tauri` 2, `wasm-bindgen`

**JavaScript**: `solid-js`, `@solidjs/router`, `@solidjs/start`, `vinxi`, `tailwindcss` 4, `lucide-solid`, `solid-sonner`
