# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendme is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh), offering:
- **CLI tool** (`sendme`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **WASM browser** - Experimental (separate build: `browser-lib/`)

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Development Commands

### Rust Workspace

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p sendme-lib      # Library only
cargo build -p sendme          # CLI only
cargo build -p app             # Tauri backend only
```

### Running Tests

```bash
# All workspace tests
cargo test --locked --workspace --all-features

# Run specific test by exact name pattern
cargo test send_recv_file

# Run integration tests only
cargo test --test cli

# Verbose output for debugging
cargo test send_recv_file -- --nocapture

# Run with staging relays (like CI)
IROH_FORCE_STAGING_RELAYS=1 cargo test
```

### Lint and Format

```bash
# Format (REQUIRED before committing)
cargo fmt --all

# Lint (warnings are errors in CI: RUSTFLAGS=-Dwarnings)
cargo clippy --locked --workspace --all-targets --all-features
```

### Tauri Desktop App

```bash
cd app
pnpm install                       # Install dependencies
pnpm run dev                       # Vinxi dev server on port 1420
pnpm run tauri dev                 # Dev with hot reload
pnpm run tauri build               # Build complete desktop app
pnpm run format                    # Prettier formatting

# Mobile builds (requires Clerk key)
CLERK_PUBLISHABLE_KEY='pk_test_...' pnpm run tauri android build
export CLERK_PUBLISHABLE_KEY='pk_test_...'
cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build
```

### Browser WASM Build

```bash
cd browser-lib
export CC=/opt/homebrew/opt/llvm/bin/clang   # macOS: Use LLVM Clang, NOT Apple Clang
cargo build --target=wasm32-unknown-unknown --release
```

## Workspace Structure

```
sendme-app/
├── lib/                    # sendme-lib - Core library (send/receive/nearby)
├── cli/                    # sendme CLI - Binary using sendme-lib
├── app/                    # Tauri desktop application
│   ├── src/                    # SolidJS frontend
│   └── src-tauri/              # Rust backend (Tauri commands)
└── browser-lib/            # WASM bindings (separate workspace - NOT in main)
```

**Note**: `browser-lib` has its own `[workspace]` section in `Cargo.toml` to isolate WASM-specific dependencies (avoiding `mio` which isn't WASM-compatible).

## Architecture

### Core Library (`lib/`)

- **`lib.rs`**: Public API exports, `get_or_create_secret()`, `canonicalized_path_to_string()`
- **`send.rs`**: Send/host - creates endpoint, imports files, serves data, spawns keep-alive task
- **`receive.rs`**: Receive/download - connects, downloads via `execute_get()`, exports to filesystem
- **`import.rs`**: File/directory import into blob store (parallelized with `num_cpus`)
- **`export.rs`**: Export from blob store to filesystem
- **`progress.rs`**: Progress event types/channels
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, `RelayModeOption`)
- **`nearby.rs`**: mDNS-based local device discovery

#### Send Flow

1. Creates/loads secret key from `IROH_SECRET` env var or generates new one
2. Builds iroh `Endpoint` with relay mode and optional DNS discovery
3. Creates temp `.sendme-send-*` directory for blob storage
4. Imports file/directory into `FsStore` (parallel, uses `num_cpus` workers)
5. Creates `BlobsProtocol` provider with progress event streaming
6. Generates `BlobTicket` (endpoint address + collection hash)
7. Spawns router keep-alive task with `std::future::pending()` to stay alive
8. Returns ticket for sharing

#### Receive Flow

1. Parses ticket to extract endpoint address and collection hash
2. Creates iroh `Endpoint` for connecting
3. Creates temp `.sendme-recv-*` directory (uses `args.common.temp_dir` if set - critical for Android)
4. Downloads collection via `execute_get()` with progress tracking
5. Exports to current directory **preserving original filenames**
6. Cleans up temp directory

### CLI (`cli/`)

Interactive Terminal UI (TUI) with ratatui + crossterm:
- **Tab** key - Switch between Send and Receive tabs
- **Enter** - Initiate send/receive with current input
- **Arrow keys** - Navigate transfer history
- Delegates to `sendme_lib::send_with_progress` and `sendme_lib::receive_with_progress`

### Tauri Desktop App

**Frontend** (`app/src/`): SolidJS + Tailwind CSS v4 + Vinxi bundler
- **`routes/index.tsx`**: Main UI (Send/Receive tabs, transfers list)
- **`bindings.ts`**: Type-safe Tauri command wrappers
- **`lib/utils.ts`**: Utilities (formatFileSize, formatDate)
- Path aliases: Use `~/*` for src/ imports

**Backend** (`app/src-tauri/src/lib.rs`): Tauri commands wrapping `sendme-lib`
- `send_file`, `receive_file`, `cancel_transfer`, `get_transfers`, `get_transfer_status`
- `start_nearby_discovery`, `get_nearby_devices`, `stop_nearby_discovery`
- Uses `tokio::sync::RwLock<HashMap>` for transfer state
- Emits progress via `app.emit("progress", update)`

## Code Style

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
- Enum variants: `PascalCase` (`AddrInfoOptions::RelayAndAddresses`)

### Common Derive Macros

```rust
#[derive(Debug)]           // All types intended for debugging
#[derive(Clone)]           // Types that need to be copied
#[derive(Serialize, Deserialize)]  // Types crossing FFI or serialization
#[serde(rename_all = "camelCase")]  // For JS/TS compatibility
#[derive_more::Display, derive_more::FromStr]  // From derive_more crate
```

### Error Handling

```rust
// Use anyhow for application errors
anyhow::bail!("custom error message");
anyhow::ensure!(condition, "error message");
.context("additional context")?

// For Tauri commands: convert to String for frontend
.map_err(|e| format!("Failed to send: {}", e))?
```

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

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send functionality
2. **Browser WASM**: Never add `browser-lib` to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`
6. **Android temp directories**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
7. **Android JNI**: Always use `push_local_frame()`/`pop_local_frame()` in loops
8. **WASM builds on macOS**: Use `export CC=/opt/homebrew/opt/llvm/bin/clang` (llvm.org Clang, NOT Apple Clang)

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

### Platform-Specific File Picking

- **Android**: Uses `tauri_plugin_android_fs` for file/directory picking
- **iOS**: Uses `tauri_plugin_fs_ios` + Documents directory (no directory picking support)
- **Desktop**: Uses `tauri_plugin_dialog`

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
