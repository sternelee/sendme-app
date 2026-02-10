# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendmd is a Rust CLI tool for sending files and directories over the internet using the [iroh](https://crates.io/crates/iroh) networking library. It provides P2P file transfer with NAT hole punching, blake3 verified streaming, and resumable downloads.

**This is a fork** that adds a Tauri desktop application with a modern SolidJS + Tailwind CSS v4 frontend.

## Package Manager

Use **pnpm** for JavaScript/TypeScript operations (defined in app/package.json):

- `pnpm install` - Install dependencies
- `pnpm run <script>` - Run npm scripts (e.g., `pnpm run tauri dev`)
- `pnpm run build` - Build frontend with TypeScript check + Vite

Note: The project scripts use `pnpm` internally regardless of whether you use Bun or pnpm as the package manager.

## Development Commands

### Rust Workspace (CLI + Lib + App Backend)

- `cargo build` - Build all workspace members
- `cargo build -p sendmd-lib` - Build only the library
- `cargo build -p sendmd` - Build only the CLI
- `cargo build -p app` - Build only the Tauri app backend
- `cargo build --release` - Build optimized release binaries
- `cargo test` - Run all tests
- `cargo test --test cli` - Run CLI integration tests specifically
- `cargo test --lib` - Run library unit tests only
- `cargo test -p sendmd-lib` - Run tests for the library crate only
- `cargo fmt --all -- --check` - Check code formatting
- `cargo clippy --locked --workspace --all-targets --all-features` - Run Clippy lints
- `cargo fmt` - Format code

### Tauri Desktop App (`app/`)

```bash
cd app
pnpm install              # Install frontend dependencies
pnpm run tauri dev        # Start development server with hot reload
pnpm run build            # Build frontend only (TypeScript check + Vite build)
pnpm run tauri build      # Build complete desktop app
```

## Workspace Structure

This is a Cargo workspace with three members:

```
iroh-sendmd/
├── lib/          # sendmd-lib crate - core library
├── cli/          # sendmd CLI - original command-line interface
├── app/          # Tauri desktop application
│   ├── src/          # SolidJS frontend
│   ├── src-tauri/    # Rust backend (Tauri commands)
│   └── package.json  # Frontend dependencies
└── browser-lib/  # WebAssembly library crate (sendmd-browser, separate workspace)
    └── src/          # Rust WASM bindings
```

**Additional Directories:**
- **`browser/`**: Legacy web demo (deprecated, uses browser-lib)

**Important Workspace Notes:**

- The `browser/` directory is deprecated. The WASM bindings have been extracted to `browser-lib/` for better workspace organization.
- **`browser-lib` has its own separate workspace** defined in its `Cargo.toml` (it is NOT part of the main workspace) to isolate WASM-specific dependencies (like avoiding `mio` which isn't WASM-compatible).
- Build `browser-lib` separately: `cargo build --target=wasm32-unknown-unknown --manifest-path=browser-lib/Cargo.toml`

## Architecture

### Library (`sendmd-lib`)

The core library (`lib/`) contains all transfer logic:

- **`lib.rs`**: Public API exports
- **`send.rs`**: Send/host functionality - creates iroh endpoint, imports files, serves data
- **`receive.rs`**: Receive/download functionality - connects to sender, downloads, exports files
- **`import.rs`**: File/directory import into iroh-blobs store (parallelized)
- **`export.rs`**: Export from iroh-blobs store to filesystem
- **`progress.rs`**: Progress event types and channels for real-time updates
- **`nearby.rs`**: mDNS-based local device discovery
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, etc.)

#### Send Flow (`send_with_progress`)

1. Creates/loads secret key from `IROH_SECRET` env var or generates new one
2. Builds iroh `Endpoint` with relay mode and optional DNS discovery
3. Creates temp `.sendmd-send-*` directory for blob storage
4. Imports file/directory into `FsStore` (parallel, uses `num_cpus` workers)
5. Creates `BlobsProtocol` provider with progress event streaming
6. Generates `BlobTicket` (endpoint address + collection hash)
7. Spawns router keep-alive task with `std::future::pending()` to stay alive
8. Returns ticket for sharing

#### Receive Flow (`receive_with_progress`)

1. Parses ticket to extract endpoint address and collection hash
2. Creates iroh `Endpoint` for connecting
3. Creates temp `.sendmd-recv-*` directory (uses `args.common.temp_dir` if set - critical for Android)
4. Downloads collection via `execute_get()` with progress tracking
5. Exports to current directory (or specified output directory) **preserving original filenames**
6. Cleans up temp directory

**Filename Preservation**: The library uses `BlobFormat::HashSeq` (Collection) which preserves directory structure and filenames across transfers. This ensures files arrive with their original names intact.

#### Progress Events

- **`ImportProgress`**: Started/FileStarted/FileProgress/FileCompleted/Completed
- **`ExportProgress`**: Started/FileStarted/FileProgress/FileCompleted/Completed
- **`DownloadProgress`**: Connecting/GettingSizes/Downloading/Completed
- **`ConnectionStatus`**: ClientConnected/ConnectionClosed/RequestStarted/RequestProgress/RequestCompleted

#### Nearby Device Discovery (`nearby.rs`)

The library supports discovering nearby Sendmd devices on the local network using mDNS:

- **`NearbyDiscovery`**: Manages mDNS discovery using `iroh::discovery::mdns::MdnsDiscovery`
- Creates endpoint with `RelayMode::Disabled` for local-only discovery
- Broadcasts hostname via `user_data_for_discovery()` for device identification
- Polls for `DiscoveryEvent` (Discovered/Expired) to update device list
- **`create_nearby_ticket()`**: Creates direct-address-only tickets for LAN transfers

Key types:
- **`NearbyDevice`**: Discovered device info (node_id, name, addresses, last_seen, available)

### CLI (`sendmd`)

The CLI (`cli/src/main.rs`) provides an interactive Terminal UI (TUI) with ratatui:

**TUI Controls:**
- **Tab** key - Switch between Send and Receive tabs
- **Enter** - Initiate send/receive with current input
- **Arrow keys** - Navigate transfer history
- Type file path directly in Send tab input
- Paste ticket string in Receive tab input

- **TUI Framework**: Built with ratatui + crossterm for cross-platform terminal UI
- **Event Loop**: Uses TICK_RATE_MS (250ms) for periodic UI updates
- **Async Background Tasks**: Send and receive operations run in background tasks with tokio channels
- **Transfer History**: Maintains list of transfers with UUID-based tracking
- **Tabs**: Send tab (file input + send button) and Receive tab (ticket input + receive button)
- Uses `clap` derive macros for argument parsing (if any CLI args are added)
- Delegates to `pisend_lib::send_with_progress` and `pisend_lib::receive_with_progress`

Key files:
- **`cli/src/main.rs`**: Entry point with event loop setup
- **`cli/src/tui/app.rs`**: Application state and transfer management
- **`cli/src/tui/ui.rs`**: UI rendering with ratatui
- **`cli/src/tui/event.rs`**: Event handling (keyboard input, terminal events)
- **`cli/src/tui/file_search.rs`**: File search functionality (currently unused)

### Tauri Desktop App

The desktop app (`app/`) has two parts:

#### Frontend (`app/src/`)

- **SolidJS** with TypeScript and Solid Start framework
- **Vinxi** as the bundler/dev server (runs on port 1420)
- **Tailwind CSS v4** for styling (with autoprefixer and postcss)
- **Lucide Solid** for icons
- **solid-sonner** for toast notifications
- **Path aliases**: Use `~/*` for src/ imports (configured in tsconfig.json)

Key files:

- **`routes/index.tsx`**: Main UI with Send/Receive tabs and transfers list
- **`bindings.ts`**: Type-safe wrappers for Tauri commands
- **`lib/utils.ts`**: Utility functions (formatFileSize, formatDate, etc.)

#### Backend (`app/src-tauri/src/`)

- **`lib.rs`**: Tauri commands that wrap `sendmd-lib` functions
- Uses `tokio::sync::RwLock<HashMap>` for transfer state management
- Emits progress events to frontend via `app.emit("progress", update)`

Registered Tauri Plugins:
- `tauri_plugin_dialog` - File/folder dialogs
- `tauri_plugin_clipboard_manager` - Clipboard access
- `tauri_plugin_notification` - System notifications
- `tauri_plugin_os` - Cross-platform OS info (hostname, device model, etc.)
- `tauri_plugin_fs` - Filesystem access
- `tauri_plugin_http` - HTTP requests
- `tauri_plugin_android_fs` - **Android file/directory picker** (Android only)
- `tauri_plugin_fs_ios` - **iOS Documents directory access** (iOS only)
- `tauri_plugin_barcode_scanner` - QR code scanning (mobile, commented out)
- `tauri_plugin_sharesheet` - Native share sheets (mobile, commented out)

Tauri Commands:

- **`send_file`**: Spawns send task, returns ticket string
- **`receive_file`**: Spawns receive task, returns result JSON
- **`cancel_transfer`**: Sends abort signal via oneshot channel
- **`get_transfers`**: Returns list of all transfers
- **`get_transfer_status`**: Returns status string for specific transfer
- **`start_nearby_discovery`**: Starts mDNS discovery for local devices
- **`get_nearby_devices`**: Returns list of discovered nearby devices
- **`stop_nearby_discovery`**: Stops mDNS discovery

### Browser WASM Library (`sendmd-browser` / `browser-lib`)

The `browser-lib` crate provides WebAssembly bindings for in-browser P2P file transfer:

**IMPORTANT**: `browser-lib` is **a workspace member** but has its own `[workspace]` section in `Cargo.toml` to isolate WASM-specific dependencies.

#### Build Requirements

```bash
# macOS: Use llvm.org Clang (NOT Apple Clang) for WASM builds
export CC=/opt/homebrew/opt/llvm/bin/clang

# Build from repository root
cargo build --target=wasm32-unknown-unknown --manifest-path=browser-lib/Cargo.toml

# Or use npm scripts from browser directory (demo app)
cd browser
pnpm run build           # Debug build with wasm-bindgen
pnpm run build:release   # Release build with wasm-bindgen
pnpm run serve           # Serve demo locally
```

#### Structure

- **`src/lib.rs`**: Main entry point, exports `SendmeNode`
- **`src/node.rs`**: Core `SendmeNode` implementation
  - Uses `iroh::Endpoint::builder().bind()` for WASM-compatible endpoint creation
  - Uses `MemStore` for in-memory blob storage
  - Creates proper `BlobTicket` with `HashSeq` format (Collection) for CLI/App compatibility
  - Implements P2P fetching via `execute_get()` with stream consumption
  - Uses JavaScript `setTimeout` for WASM-compatible async sleeping (`sleep_ms()`)
- **`src/wasm.rs`**: `wasm-bindgen` exports for JavaScript interop
  - `SendmeNodeWasm` wrapper struct with JS-friendly API
  - Returns `js_sys::Promise` for async operations
  - Converts between `Uint8Array` and Rust `Bytes`

#### Key Implementation Details

- **Endpoint creation**: Uses `iroh::Endpoint::builder().bind()` which handles key generation internally (WASM-compatible)
- **No `tokio::time::sleep`**: Uses custom `sleep_ms()` function with `web_sys::window().set_timeout()` via `JsFuture`
- **Workspace isolation**: Has `[workspace]` section to prevent WASM-incompatible deps (like `mio`) from affecting the main workspace
- **Collection format**: Uses `BlobFormat::HashSeq` (Collection) to preserve filenames and ensure compatibility with CLI/App
- **Static discovery**: Uses `StaticProvider` for manual peer discovery via ticket addresses

#### JavaScript API

```javascript
import init, { SendmeNodeWasm } from "./wasm/pisend_browser.js";

await init();
const node = await SendmeNodeWasm.spawn();

// Check endpoint status
const ready = await node.wait_for_ready(5000);

// Send file (create ticket)
const ticket = await node.import_and_create_ticket(filename, dataArray);

// Receive file (fetch from ticket)
const result = await node.get(ticketString);
// result = { filename: string, data: Uint8Array }
```

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

## Important Implementation Details

### Recursion Limit

The Tauri app backend (`app/src-tauri/src/lib.rs`) defines platform-specific logging macros. If you encounter "recursion limit reached while expanding `log_info!`" compilation errors, add to the top of the file:

```rust
#![recursion_limit = "256"]
```

Note: The non-Android variants of these macros are currently stubs that recursively call themselves - they should be fixed to actually call the underlying `log` macros.

### Android Temp Directory (CRITICAL)

**This is a common source of bugs on Android.**

Android apps run in a sandbox and cannot write to arbitrary directories. Always use `args.common.temp_dir` instead of `std::env::current_dir()`:

```rust
// CORRECT: Use temp_dir from config
let base_dir = args.common.temp_dir.as_ref().cloned()
    .unwrap_or_else(|| std::env::current_dir()?);

// WRONG: Never use current_dir() on Android
let iroh_data_dir = std::env::current_dir()?.join(dir_name);
```

**In Tauri backend**, always provide `temp_dir`:
```rust
let temp_dir = app.path().temp_dir()?;
let args = ReceiveArgs {
    ticket,
    common: CommonConfig {
        temp_dir: Some(temp_dir),  // CRITICAL for Android
        // ...
    },
};
```

**Why this matters:**
- Android's `current_dir()` may point to read-only directories
- `app.path().temp_dir()` returns app's cache directory (writable)
- Without this, file export fails with "Read-only file system" error

See `ANDROID_FIX_SUMMARY.md` for full debugging guide.

### Router Keep-Alive (CRITICAL)

**The sender's router must stay alive to serve incoming connections.** This is a critical pattern:

```rust
tokio::spawn(async move {
    let _router = router;
    std::future::pending::<()>().await;  // Runs forever
});
```

**Why this matters:**
- The router handles incoming P2P connections for file transfers
- If the router is dropped, no new connections can be established
- `std::future::pending()` creates a future that never completes, keeping the task alive
- Do NOT replace this with a sleep loop or the router will drop after the sleep
- Location: `lib/src/send.rs:152-156`

### Progress Channels

- Use `tokio::sync::mpsc::channel(32)` for progress event streaming
- Sender spawns task to consume events and emit to frontend
- Frontend uses `listen("progress", callback)` to receive events

### Abort Handling

- Each transfer has `Option<tokio::sync::oneshot::Sender<()>>` for abort
- Cancel sends `()` through channel, task listens via `abort_rx.await`
- Transfer state tracks abort sender to enable cancellation

### Path Handling

- All temp directories use `.sendmd-*` prefix
- `canonicalized_path_to_string()`: Platform-agnostic path conversion
- Validates path components to prevent directory traversal

### Ticket Types

- **`Id`**: Smallest ticket, requires DNS discovery
- **`Relay`**: Uses relay server only
- **`Addresses`**: Direct addresses only
- **`RelayAndAddresses`**: Both relay and direct (default, most reliable)

## MSRV

Minimum Supported Rust Version: **1.81** (defined in workspace Cargo.toml)

## Testing

```bash
# Run all tests
cargo test

# Run specific test modules
cargo test --test cli          # CLI integration tests
cargo test --lib               # Library unit tests
cargo test -p sendmd-lib       # Library crate tests only

# Run tests with output
cargo test -- --nocapture

# Run specific test
cargo test test_name

# Run with staging relays (like CI)
IROH_FORCE_STAGING_RELAYS=1 cargo test
```

### CI Environment Variables

When running tests in CI or reproducing CI failures:
- `RUSTFLAGS=-Dwarnings` - All warnings are treated as errors
- `IROH_FORCE_STAGING_RELAYS=1` - Use staging relay servers instead of production
- TypeScript strict mode is enabled with noUnusedLocals, noUnusedParameters, and noFallthroughCasesInSwitch

## Debugging

### Android Debugging

Android development has special debugging considerations:

```bash
# Setup ADB
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# View logs in real-time
adb logcat | grep -E "sendmd|iroh|rust"

# Save logs to file
adb logcat > ~/android_debug.log

# Key log points to watch for:
# - "receive_file called with ticket"
# - "Android: output_dir specified but ignored"
# - "Failed to change to output directory"
# - "Invalid ticket"
# - "Connection failed"
# - Progress events: "Connecting"/"Downloading"
```

See `ANDROID_DEBUG_GUIDE.md` for complete debugging workflow.

### Common Issues

1. **"Recursion limit reached" errors**: Add `#![recursion_limit = "256"]` to top of `app/src-tauri/src/lib.rs`
2. **Android "Read-only file system"**: Ensure `args.common.temp_dir` is set correctly (see Android Temp Directory section above)
3. **Router dropping connections**: Never remove `std::future::pending()` from send tasks
4. **WASM build failures on macOS**: Use `export CC=/opt/homebrew/opt/llvm/bin/clang` for WASM builds

## Mobile Development

The Tauri app supports mobile platforms (iOS/Android) with special considerations:

### Platform-Specific Handling

- **Hostname detection**: Uses `tauri_plugin_os::hostname()` for cross-platform compatibility
- **Temp directories**: Uses `std::env::temp_dir()` for macOS sandbox compatibility
- **Device model**: Uses `tauri_plugin_os::platform()` to detect mobile platforms

### Mobile-Optimized UI

- Uses `vconsole` for mobile debugging (in app dependencies)
- QR code scanning via `tauri_plugin_barcode_scanner` (currently commented out)
- Native share sheets via `tauri_plugin_sharesheet` (currently commented out)

### Building for Mobile

```bash
cd app
pnpm run tauri android build  # Build Android APK
pnpm run tauri ios build      # Build iOS app
```

### Android Build Customization

The Android build includes custom Kotlin files and ProGuard rules that are copied during the build process:

- **`app/src-tauri/build.rs`**: Build script that copies custom Android code
- **`app/src-tauri/android-includes/`**: Contains custom Kotlin source files and ProGuard rules
  - `sendmd/leechat/app/FileUtils.kt`: File utilities for Android
  - `proguard-jni.pro`: JNI ProGuard rules
- Files are copied to `gen/android/app/` during compilation via `build.rs`

### Mobile File Picker

The app uses platform-specific plugins for file/directory operations:

#### Android: `tauri_plugin_android_fs` (Official Crate)

- **File Picking**: Opens native file picker, returns list of selected files with metadata
- **Directory Picking**: Opens directory picker, returns selected directory URI
- **Persistable Permissions**: Automatically takes persistable URI permissions for long-term access

**Key Android API:**
```rust
let api = app.android_fs_async();

// Pick files
let uris = api.file_picker().pick_files(None, &["*/*"], false).await?;

// Pick directory
let uri = api.file_picker().pick_dir(None, false).await?;

// Get file metadata
let name = api.get_name(&uri).await?;
let mime_type = api.get_mime_type(&uri).await?;

// Open file for reading
let file = api.open_file_readable(&uri).await?;
```

#### iOS: `tauri_plugin_fs_ios` + Documents Directory

**Important**: iOS does NOT support directory picking. All received files are automatically saved to the app's **Documents directory**.

- **File Picking**: Returns Documents directory info (files accessed via Documents)
- **Directory Picking**: NOT SUPPORTED - all received files go to Documents
- **File Operations**: Uses `tauri_plugin_fs_ios` for Documents directory access

**Key iOS API:**
```rust
let fs_ios = app.fs_ios();

// Get Documents directory path
let docs_path = fs_ios.current_dir()?;

// For received files: automatically saved to Documents
// List files in Documents
let entries = std::fs::read_dir(&docs_path)?;
```

**iOS File Flow:**
1. Receiving files → Automatically saved to Documents directory
2. `get_default_download_folder()` → Returns Documents path
3. `list_received_files()` → Lists files in Documents
4. `open_received_file()` → Opens files from Documents

#### Desktop: `tauri_plugin_dialog`

Standard file/folder dialogs via `tauri_plugin_dialog`.

**Note:** The AGENTS.md file references a non-existent `tauri-plugin-mobile-file-picker` plugin - this is a legacy reference and can be ignored. The actual implementation uses platform-specific plugins as described above.

## Environment Variables

### Rust/iroh

- **`IROH_SECRET`**: Hex-encoded 32-byte secret key for endpoint identity (optional, generates random if not set)
- **`IROH_FORCE_STAGING_RELAYS`**: Set to `1` to use staging relay servers (used in CI tests)
- **`RUST_LOG`**: Logging level (e.g., `debug`, `info`, `warn`, `error`)

### Build/CI

- **`RUSTFLAGS`**: Compiler flags; CI uses `-Dwarnings` to treat warnings as errors
- **`CC`**: For WASM builds on macOS, set to `/opt/homebrew/opt/llvm/bin/clang` (llvm.org Clang, NOT Apple Clang)

## Additional Documentation

- **`AGENTS.md`**: Comprehensive guide for AI coding agents with detailed workflows and code style guidelines
- **`ANDROID_DEBUG_GUIDE.md`**: Step-by-step Android debugging workflow
- **`ANDROID_FIX_SUMMARY.md`**: Details on Android temp directory fixes
- **`ANDROID_FILENAME_PRESERVATION.md`**: Android-specific filename handling notes
