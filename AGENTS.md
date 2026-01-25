# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

PiSend is a **P2P file transfer system** built with [iroh](https://crates.io/crates/iroh) networking library, offering:
- **CLI tool** (`pisend`) - Interactive TUI with ratatui
- **Desktop app** (Tauri) - Windows/macOS/Linux with SolidJS + Tailwind CSS v4
- **Mobile apps** - iOS & Android native
- **WASM browser** - Experimental in-browser P2P (separate build)

### Cargo Workspace Structure

```
iroh-pisend/
├── lib/                    # pisend-lib - Core library (send/receive/nearby)
├── cli/                    # pisend CLI - Binary using pisend-lib
├── app/src-tauri/          # app - Tauri backend
└── browser-lib/            # pisend-browser - WASM bindings (separate workspace)
```

**Important**: `browser-lib` is excluded from the main workspace to avoid WASM-incompatible dependencies. Build separately.

### pnpm Workspace Structure

```yaml
# pnpm-workspace.yaml
packages:
  - "app"                   # Tauri frontend
  - "browser"               # Web demo (deprecated)
```

**Note**: The pnpm-workspace.yaml references a non-existent `tauri-plugin-mobile-file-picker` package (legacy reference from previous architecture).

**Package Manager**: Use **pnpm** for ALL JavaScript/TypeScript operations (NOT npm or yarn).

## Build, Lint, and Test Commands

### Rust Commands

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p pisend-lib      # Library only
cargo build -p pisend          # CLI only (binary name: pisend)
cargo build -p app             # Tauri backend only

# Format (REQUIRED before committing)
cargo fmt --all
cargo fmt --all -- --check     # Check only

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
cargo test send_recv_file                    # Single test function
cargo test send_recv_dir                     # Another test function

# Test specific package
cargo test -p pisend-lib                     # Library tests only
cargo test -p cli                            # CLI tests only

# Run integration tests only
cargo test --test cli                        # tests/cli.rs

# Run library unit tests only
cargo test --lib -p pisend-lib

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

# Mobile builds (Android)
pnpm run tauri android build
pnpm run tauri android build --target aarch64

# Mobile builds (iOS, macOS only)
pnpm run tauri ios build

# Format frontend code
pnpm run format                    # Prettier formatting
```

### Browser WASM Build (Separate - NOT in workspace)

```bash
cd browser-lib
# macOS: Use LLVM Clang (NOT Apple Clang)
export CC=/opt/homebrew/opt/llvm/bin/clang
cargo build --target=wasm32-unknown-unknown
cargo build --target=wasm32-unknown-unknown --release

# Or build from browser demo
cd browser
pnpm run build:wasm                # Debug build
pnpm run build:wasm:release        # Release build
pnpm run build                     # Full demo build
pnpm run deploy                    # Deploy to Cloudflare
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
- **Path Handling**: All temp directories use `.pisend-*` prefix
- **Nearby Discovery**: Uses mDNS, requires same WiFi network
- **Release Profile**: Optimized for size (`opt-level = "s"`, LTO, strip debug)

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send functionality (lib/src/send.rs)
2. **Browser WASM**: Never add `browser-lib` to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Android content URIs**: Handle `content://` URIs specially in Tauri (see `app/src-tauri/src/lib.rs`)
6. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`
7. **Android temp directories**: Use `args.common.temp_dir` instead of `std::env::current_dir()` (see ANDROID_FIX_SUMMARY.md)
8. **Recursion limit**: If compilation fails with "recursion limit reached while expanding `log_info!`", add `#![recursion_limit = "256"]` to the top of `app/src-tauri/src/lib.rs`
9. **Android JNI**: Always use `push_local_frame()`/`pop_local_frame()` when making JNI calls in loops to prevent local reference overflow
10. **pnpm workspace**: `pnpm-workspace.yaml` references non-existent `tauri-plugin-mobile-file-picker` (legacy reference, can be ignored)

## Architecture Deep Dive

### Core Library (`lib/`)

All transfer logic lives here:

- **`lib.rs`**: Public API exports, `get_or_create_secret()` function
- **`send.rs`**: Send/host functionality - creates endpoint, imports files, serves data
  - Uses `FsStore` for blob storage in `.pisend-send-*` temp directory
  - Creates `BlobTicket` with endpoint address + collection hash
  - Spawns router keep-alive task with `std::future::pending()` to stay alive
- **`receive.rs`**: Receive/download functionality - connects to sender, downloads, exports files
  - Uses temp `.pisend-recv-*` directory (respects `args.common.temp_dir`)
  - Downloads via `execute_get()` with progress tracking
- **`import.rs`**: File/directory import into iroh-blobs store (parallelized with `num_cpus` workers)
- **`export.rs`**: Export from iroh-blobs store to filesystem
- **`progress.rs`**: Progress event types and channels for real-time updates
  - `ImportProgress`: Started/FileStarted/FileProgress/FileCompleted/Completed
  - `ExportProgress`: Started/FileStarted/FileProgress/FileCompleted/Completed
  - `DownloadProgress`: Connecting/GettingSizes/Downloading/Completed
  - `ConnectionStatus`: ClientConnected/ConnectionClosed/RequestStarted/RequestProgress/RequestCompleted
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, etc.)

#### Send Flow

1. Creates/loads secret key from `IROH_SECRET` env var or generates new one
2. Builds iroh `Endpoint` with relay mode and optional DNS discovery
3. Creates temp `.pisend-send-*` directory for blob storage
4. Imports file/directory into `FsStore` (parallel, uses `num_cpus` workers)
5. Creates `BlobsProtocol` provider with progress event streaming
6. Generates `BlobTicket` (endpoint address + collection hash)
7. Spawns router keep-alive task with `std::future::pending()` to stay alive
8. Returns ticket for sharing

#### Receive Flow

1. Parses ticket to extract endpoint address and collection hash
2. Creates iroh `Endpoint` for connecting
3. Creates temp `.pisend-recv-*` directory (uses `args.common.temp_dir` if set)
4. Downloads collection via `execute_get()` with progress tracking
5. Exports to current directory (or specified output directory)
6. Cleans up temp directory

### CLI (`cli/`)

Thin wrapper around `pisend-lib`:

- Uses `clap` derive macros for argument parsing
- Interactive TUI built with `ratatui`
- Multi-progress bars with `indicatif`
- Event loop with crossterm backend

### Tauri Desktop/Mobile App (`app/`)

#### Frontend (`app/src/`)

- **SolidJS** with TypeScript (NOT React or Vue)
- **Tailwind CSS v4** for styling
- **Lucide Solid** for icons
- **solid-sonner** for toast notifications
- **Vinxi** bundler (port 1420 for dev)

Key files:
- **`routes/index.tsx`**: Main UI with Send/Receive tabs and transfers list
- **`bindings.ts`**: Type-safe wrappers for Tauri commands
- **`lib/utils.ts`**: Utility functions (formatFileSize, formatDate, etc.)

#### Backend (`app/src-tauri/src/lib.rs`)

Tauri commands that wrap `pisend-lib` functions:

- **`send_file`**: Spawns send task, returns ticket string
- **`receive_file`**: Spawns receive task, returns result JSON
- **`cancel_transfer`**: Sends abort signal via oneshot channel
- **`get_transfers`**: Returns list of all transfers
- **`get_transfer_status`**: Returns status string for specific transfer
- **`start_nearby_discovery`**: Starts mDNS discovery for local devices
- **`get_nearby_devices`**: Returns list of discovered nearby devices
- **`stop_nearby_discovery`**: Stops mDNS discovery

Uses `tokio::sync::RwLock<HashMap>` for transfer state management.

Emits progress events to frontend via `app.emit("progress", update)`.

Registered Tauri Plugins:
- `tauri_plugin_dialog` - File/folder dialogs (desktop)
- `tauri_plugin_clipboard_manager` - Clipboard access
- `tauri_plugin_notification` - System notifications
- `tauri_plugin_os` - Cross-platform OS info (hostname, device model, etc.)
- `tauri_plugin_fs` - Filesystem access (desktop)
- `tauri_plugin_http` - HTTP requests
- `tauri_plugin_android_fs` - Android file/directory picker with SAF support (Android only)
- `tauri_plugin_fs_ios` - iOS Documents directory access (iOS only)
- `tauri_plugin_barcode_scanner` - QR code scanning (mobile only, both iOS/Android)
- `tauri_plugin_sharesheet` - Native share sheets (mobile only, both iOS/Android)
- `tauri_plugin_opener` - Open files with default apps
- `tauri_plugin_updater` - Auto-updater (desktop only, not mobile)

#### Platform-Specific Code

- **Android**: 
  - Uses `log` crate for logging (via `android_logger`)
  - Handles `content://` URIs specially with `tauri_plugin_android_fs`
  - Custom JNI integration via `android.rs` module:
    - `open_file_with_intent()`: Opens files using Android Intent system
    - `find_received_files()`: Lists downloaded files in app directory
  - Kotlin utilities in `FileUtils.kt`:
    - `writeFileToContentUri()`: Writes files to SAF tree URIs
    - MIME type detection for proper file creation
    - DocumentFile API for reliable tree URI handling
- **iOS**: 
  - Uses `tracing` for logging
  - All received files go to Documents directory (no directory picker)
- **Desktop**: 
  - Uses `tracing` for logging
  - Standard file dialogs via `tauri_plugin_dialog`

### Mobile File Picker Implementation

File picking is handled differently across platforms:

- **Desktop**: Uses `tauri_plugin_dialog` for standard file/folder dialogs
- **Android**: Uses `tauri_plugin_android_fs` (official crate) for Storage Access Framework (SAF) integration
  - Supports persistable URI permissions for long-term access
  - Handles `content://` URIs from document provider
  - Custom `FileUtils.kt` (in `app/src-tauri/gen/android/app/src/main/java/pisend/leechat/app/`) provides:
    - `writeFileToContentUri()`: Writes file data to content URI directories
    - MIME type detection for proper file creation
- **iOS**: Uses `tauri_plugin_fs_ios` for iOS Documents directory access
  - All received files automatically saved to app's Documents directory
  - No directory picker support (iOS limitation)

**Key Android APIs**:
```rust
let api = app.android_fs_async();
// Pick files
let uris = api.file_picker().pick_files(None, &["*/*"], false).await?;
// Pick directory (returns tree URI)
let uri = api.file_picker().pick_dir(None, false).await?;
// Get file metadata
let name = api.get_name(&uri).await?;
let size = api.get_size(&uri).await?;
// Read file
let file = api.open_file_readable(&uri).await?;
```

**Android JNI Integration**:
The Rust backend calls into Kotlin code for advanced operations:
```rust
// JNI call to FileUtils.writeFileToContentUri
// From app/src-tauri/src/lib.rs around line 240-320
let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
let mut env = vm.attach_current_thread()?;
let class = env.find_class("pisend/leechat/app/FileUtils")?;

// Call static method: writeFileToContentUri(Context, String, String, byte[]) -> boolean
env.call_static_method(
    &class,
    "writeFileToContentUri",
    "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;[B)Z",
    &[context, dir_uri, filename, byte_array]
)?;
```

**Key JNI Pattern**: Always use local frames when making JNI calls in loops to prevent local reference overflow:
```rust
env.push_local_frame(16)?;
// ... JNI calls here ...
env.pop_local_frame(&JObject::null())?;
```

### Browser WASM Library (`browser-lib/`)

**Separate workspace** to avoid WASM-incompatible dependencies.

Key implementation details:
- Uses `iroh::Endpoint::builder().bind()` for WASM-compatible endpoint creation
- Uses `MemStore` for in-memory blob storage
- Custom `sleep_ms()` function with `web_sys::window().set_timeout()` (no `tokio::time::sleep`)
- Uses `BlobFormat::HashSeq` (Collection) to preserve filenames
- `wasm-bindgen` exports for JavaScript interop

## Android Development

### Building for Android

```bash
cd app
pnpm run tauri android build
pnpm run tauri android build --target aarch64
```

### Debugging Android

```bash
# Setup ADB
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# Connect device
adb devices

# View logs in real-time
adb logcat | grep -i "pisend\|iroh\|rust"
adb logcat | grep -E "ERROR|WARN|pisend"
adb logcat > ~/android_debug.log
```

Key log points:
- `receive_file called with ticket`
- `Android: output_dir specified but ignored`
- `Failed to change to output directory`
- `Invalid ticket`
- `Connection failed`
- `Progress event: Connecting/Downloading`

See `ANDROID_DEBUG_GUIDE.md` for full debugging workflow.

### Android-Specific Issues

See `ANDROID_FIX_SUMMARY.md` for details on:
- Temp directory usage (`args.common.temp_dir` vs `current_dir()`)
- Content URI handling (`content://` URIs)
- Filename preservation across transfers

## Testing

### Unit Tests

```bash
cargo test --lib -p pisend-lib     # Library unit tests
```

### Integration Tests

```bash
cargo test --test cli              # CLI integration tests (tests/cli.rs)
```

Integration tests use `duct` for process spawning and `tempfile` for test directories.

Key test cases:
- `send_recv_file`: Send single file, parse ticket, receive and verify
- `send_recv_dir`: Send directory, verify structure preserved

### CI Environment

GitHub Actions workflows:
- `.github/workflows/release.yml` - Tauri desktop/mobile builds
- `.github/workflows/release-cli.yml` - CLI binary releases

CI uses:
- `RUSTFLAGS: -Dwarnings` (warnings are errors)
- `IROH_FORCE_STAGING_RELAYS: 1` (staging relays in tests)
- `pnpm` version 9
- Rust stable toolchain
- Cross-platform builds (Linux, macOS, Windows, iOS, Android)

## Key Data Structures

### Library Types

- **`Collection`**: Set of files (hash + name pairs) representing a directory tree
- **`BlobTicket`**: Encodes endpoint address + hash for sharing (base32 string)
- **`Store`/`FsStore`**: Content-addressed storage backend for blake3-verified data
- **`Endpoint`**: iroh networking endpoint with NAT hole-punching and relay support

### Frontend Types

```typescript
interface Transfer {
  id: string;
  transfer_type: "send" | "receive";
  path: string;
  status: string; // "initializing" | "serving" | "downloading" | "completed" | "error" | "cancelled"
  created_at: number; // Unix timestamp
}

interface ProgressUpdate {
  event_type: "import" | "export" | "download" | "connection";
  data: ProgressData & { transfer_id: string };
}
```

### Ticket Types

- **`Id`**: Smallest ticket, requires DNS discovery
- **`Relay`**: Uses relay server only
- **`Addresses`**: Direct addresses only
- **`RelayAndAddresses`**: Both relay and direct (default, most reliable)

## File References

Use `path:line` format for code references (e.g., `lib/src/send.rs:42`).

## Project Structure

```
iroh-pisend/
├── lib/src/                    # Core library
│   ├── lib.rs                  # Public API exports
│   ├── send.rs                 # Send functionality
│   ├── receive.rs              # Receive functionality
│   ├── import.rs               # File import to blob store
│   ├── export.rs               # Blob store to filesystem
│   ├── progress.rs             # Progress reporting
│   ├── nearby.rs               # mDNS local device discovery
│   └── types.rs                # Core types
├── cli/src/                    # CLI with TUI
│   ├── main.rs                 # Entry point
│   └── tui/                    # Ratatui TUI components
├── app/                        # Tauri desktop/mobile app
│   ├── src/                    # SolidJS frontend
│   │   ├── routes/index.tsx    # Main UI
│   │   ├── bindings.ts         # Tauri command wrappers
│   │   └── lib/utils.ts        # Utilities
│   └── src-tauri/              # Rust backend
│       ├── src/
│       │   ├── lib.rs          # Tauri commands
│       │   └── android.rs      # Android JNI helpers
│       └── gen/android/app/src/main/java/pisend/leechat/app/
│           ├── FileUtils.kt    # Android file operations
│           └── MainActivity.kt # Android activity
├── browser-lib/                # WASM bindings (separate workspace)
│   ├── src/lib.rs              # Main entry
│   ├── src/node.rs             # SendmeNode implementation
│   └── src/wasm.rs             # wasm-bindgen exports
├── browser/                    # Web demo (deprecated)
└── tests/cli.rs                # Integration tests
```

## Environment Variables

- **`IROH_SECRET`**: Hex-encoded 32-byte secret key for endpoint (optional, generates random if not set)
- **`IROH_FORCE_STAGING_RELAYS`**: Set to `1` to use staging relays (used in CI tests)
- **`RUST_LOG`**: Tracing level (e.g., `debug`, `info`, `warn`, `error`)

## Release Process

### CLI Binary

```bash
# Trigger workflow from GitHub UI: .github/workflows/release-cli.yml
# Creates release with binaries for:
# - x86_64-unknown-linux-gnu
# - x86_64-apple-darwin
# - aarch64-apple-darwin
# - x86_64-pc-windows-msvc
```

### Tauri App

```bash
# Trigger workflow from GitHub UI: .github/workflows/release.yml
# Uses CrabNebula Cloud for release management
# Builds for:
# - Windows (x86_64)
# - macOS (x86_64 + aarch64)
# - Linux (x86_64)
```

## Dependencies

### Key Rust Crates

- `iroh` 0.95 - Networking library
- `iroh-blobs` 0.97 - Content-addressed blob storage
- `tokio` 1.34 - Async runtime
- `anyhow` - Error handling
- `clap` - CLI argument parsing (CLI)
- `ratatui` - Terminal UI (CLI)
- `tauri` 2 - Desktop/mobile framework (App)
- `wasm-bindgen` - WASM bindings (Browser)

### Key JavaScript Dependencies

- `solid-js` - Reactive UI framework
- `@solidjs/router` - Routing
- `@solidjs/start` - Meta-framework
- `vinxi` - Bundler
- `tailwindcss` 4 - Styling
- `lucide-solid` - Icons
- `solid-sonner` - Toasts

## Performance Considerations

- Parallel file import using `num_cpus` workers
- Blake3 verified streaming (no need to hash entire file first)
- Content-addressed storage for deduplication
- NAT hole punching for direct connections (faster than relay)

## Security Notes

- All transfers use TLS encryption
- Blake3 hash verification for all data
- 256-bit node IDs for identity
- No central server required (P2P)
- Secure ticket-based sharing
