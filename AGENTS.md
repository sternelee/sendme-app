# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendme`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **WASM browser** - Experimental (separate build: `browser-lib/`)

### Cargo Workspace Structure

```
sendme-app/
├── lib/                    # sendme-lib - Core library (send/receive/nearby)
├── cli/                    # sendme CLI - Binary using sendme-lib
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
cargo build -p sendme-lib      # Library only
cargo build -p sendme          # CLI only
cargo build -p app             # Tauri backend only

# Format (REQUIRED before committing)
cargo fmt --all

# Lint (warnings are errors in CI: RUSTFLAGS=-Dwarnings)
cargo clippy --locked --workspace --all-targets --all-features
```

### Running Tests

```bash
# All workspace tests
cargo test --locked --workspace --all-features

# Run specific test by exact name pattern
cargo test send_recv_file
cargo test transfer_file

# Run integration tests only
cargo test --test cli

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
pnpm run tauri build               # Build complete desktop app
pnpm run format                    # Prettier formatting

# Mobile builds
pnpm run tauri android build
export CLERK_PUBLISHABLE_KEY='pk_test_...'
cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build
xcrun devicectl device install app --device <device-id> "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
```

For iOS in this repo, prefer direct `xcodebuild` + `devicectl` over `pnpm run tauri ios build`. The generated Xcode prebuild script already rebuilds the frontend, syncs `dist/` into `gen/apple/assets`, and compiles the Rust library with `custom-protocol` enabled.

### Browser WASM Build (Separate - NOT in workspace)

```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # macOS: Use LLVM Clang
cargo build --target=wasm32-unknown-unknown --release
```

## Code Style Guidelines

### Rust Import Order

Use ordered groups with blank lines between:

```rust
// 1. Standard library
use std::{collections::BTreeMap, sync::{Arc, Mutex}, time::Instant};

// 2. External crates (alphabetical)
use anyhow::Context;
use iroh::{Endpoint, RelayMode};
use tokio::select;

// 3. Local crate imports
use crate::{progress::*, types::*};
```

### Rust Naming Conventions

- Types/Structs/Enums: `PascalCase` (`SendResult`, `NearbyDevice`)
- Functions/Methods: `snake_case` (`send_with_progress`, `get_or_create_secret`)
- Constants: `SCREAMING_SNAKE_CASE` (`MSRV`, `ALPN`, `TICK_RATE_MS`)
- Modules: `snake_case` (`send`, `receive`, `progress`)
- Enums variants: `PascalCase` (`AddrInfoOptions::RelayAndAddresses`)

### Rust Derive Macros

Common derives used across the codebase:

```rust
// Debug for all types intended for debugging
#[derive(Debug)]
// Clone for types that need to be copied
#[derive(Clone)]
// Serialize/Deserialize for types crossing FFI or serialization boundaries
#[derive(Serialize, Deserialize)]
// #[serde(rename_all = "camelCase")] for JS/TS compatibility
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
// derive_more for Display, FromStr, etc.
#[derive_more::Display, derive_more::FromStr]
```

### Rust Error Handling

```rust
// Use anyhow for application errors
anyhow::bail!("custom error message");
anyhow::ensure!(condition, "error message");
.context("additional context")?

// Pattern matching on anyhow errors
match e.downcast_ref::<std::io::Error>() {
    Some(_) => handle_io_error(e),
    None => Err(e),
}

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

// Select with cancellation
tokio::select! {
    _ = cancel_rx.recv() => return,
    result = async_operation() => result?,
}
```

### TypeScript/SolidJS Style

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { send_file, type SendFileRequest } from "~/lib/commands";

// Explicit types for signals
const [devices, setDevices] = createSignal<NearbyDevice[]>([]);

// Import paths use ~/* alias for src/ (configured in tsconfig.json)

// Event handling with explicit types
const handleProgress = (event: ProgressEvent) => {
  setTransfers((prev) => [...prev, event]);
};
```

## Important Details

- **MSRV**: 1.81 (Minimum Supported Rust Version)
- **CI Environment**: `RUSTFLAGS: -Dwarnings` (all warnings are errors)
- **CI Environment**: `IROH_FORCE_STAGING_RELAYS: 1` (use staging relays in tests)
- **TypeScript**: Strict mode enabled (noUnusedLocals, noUnusedParameters)
- **Frontend Framework**: SolidJS with Vinxi bundler and Tailwind CSS v4
- **Path Handling**: All temp directories use `.sendme-*` prefix
- **Nearby Discovery**: Uses mDNS, requires same WiFi network
- **Release Profile**: Optimized for size (`opt-level = "s"`, LTO, strip debug)

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send functionality
2. **Browser WASM**: Never add `browser-lib` to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Android content URIs**: Handle `content://` URIs specially in Tauri
6. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`
7. **Android temp directories**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
8. **Recursion limit**: If compilation fails, add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`
9. **Android JNI**: Always use `push_local_frame()`/`pop_local_frame()` in loops
10. **iOS signing**: `app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements` must stay empty for personal-team signing, and the reliable install path is `xcodebuild` + `devicectl`

## Architecture Overview

### Core Library (`lib/`)

- **`lib.rs`**: Public API exports, `get_or_create_secret()`, `canonicalized_path_to_string()`
- **`send.rs`**: Send/host - creates endpoint, imports files, serves data, spawns keep-alive task
- **`receive.rs`**: Receive/download - connects, downloads via `execute_get()`, exports to filesystem
- **`import.rs`**: File/directory import into blob store (parallelized with `num_cpus`)
- **`export.rs`**: Export from blob store to filesystem
- **`progress.rs`**: Progress event types/channels
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, `RelayModeOption`)

### Tauri App (`app/`)

**Frontend** (`app/src/`): SolidJS + Tailwind CSS v4
- **`routes/index.tsx`**: Main UI (Send/Receive tabs, transfers list)
- **`bindings.ts`**: Type-safe Tauri command wrappers
- **`lib/utils.ts`**: Utilities (formatFileSize, formatDate)

**Backend** (`app/src-tauri/src/lib.rs`): Tauri commands wrapping `sendme-lib`
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
