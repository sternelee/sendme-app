# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sendme is a Rust CLI tool for sending files and directories over the internet using the [iroh](https://crates.io/crates/iroh) networking library. It provides P2P file transfer with NAT hole punching, blake3 verified streaming, and resumable downloads.

**This is a fork** that adds a Tauri desktop application with a modern Vue + shadcn/ui frontend.

## Package Manager

**Use Bun instead of npm/pnpm** for all JavaScript/TypeScript operations:

- `pnpm install` instead of `npm install` or `pnpm install`
- `pnpm run <script>` instead of `npm run <script>` or `pnpm run <script>`
- `bunx <package>` instead of `npx <package>`

## Development Commands

### Rust Workspace (CLI + Lib + App Backend)

- `cargo build` - Build all workspace members
- `cargo build -p sendme-lib` - Build only the library
- `cargo build -p sendme` - Build only the CLI
- `cargo build -p app` - Build only the Tauri app backend
- `cargo build --release` - Build optimized release binaries
- `cargo test` - Run all tests
- `cargo test --test cli` - Run CLI integration tests specifically
- `cargo fmt --all -- --check` - Check code formatting
- `cargo clippy --locked --workspace --all-targets --all-features` - Run Clippy lints
- `cargo fmt` - Format code

### Tauri Desktop App (`app/`)

- `cd app && pnpm run tauri dev` - Start development server with hot reload
- `cd app && pnpm run build` - Build frontend only (TypeScript check + Vite build)
- `cd app && pnpm run tauri build` - Build complete desktop app

## Workspace Structure

This is a Cargo workspace with four members:

```
iroh-sendme/
├── lib/          # sendme-lib crate - core library
├── cli/          # sendme CLI - original command-line interface
├── app/          # Tauri desktop application
│   ├── src/          # Vue frontend
│   ├── src-tauri/    # Rust backend (Tauri commands)
│   └── package.json  # Frontend dependencies
└── browser/      # WebAssembly browser bindings
    ├── src/          # Rust WASM bindings
    ├── public/       # Web demo
    └── package.json  # Build scripts
```

## Architecture

### Library (`sendme-lib`)

The core library (`lib/`) contains all transfer logic:

- **`lib.rs`**: Public API exports
- **`send.rs`**: Send/host functionality - creates iroh endpoint, imports files, serves data
- **`receive.rs`**: Receive/download functionality - connects to sender, downloads, exports files
- **`import.rs`**: File/directory import into iroh-blobs store (parallelized)
- **`export.rs`**: Export from iroh-blobs store to filesystem
- **`progress.rs`**: Progress event types and channels for real-time updates
- **`types.rs`**: Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, etc.)

#### Send Flow (`send_with_progress`)

1. Creates/loads secret key from `IROH_SECRET` env var or generates new one
2. Builds iroh `Endpoint` with relay mode and optional DNS discovery
3. Creates temp `.sendme-send-*` directory for blob storage
4. Imports file/directory into `FsStore` (parallel, uses `num_cpus` workers)
5. Creates `BlobsProtocol` provider with progress event streaming
6. Generates `BlobTicket` (endpoint address + collection hash)
7. Spawns router keep-alive task with `std::future::pending()` to stay alive
8. Returns ticket for sharing

#### Receive Flow (`receive_with_progress`)

1. Parses ticket to extract endpoint address and collection hash
2. Creates iroh `Endpoint` for connecting
3. Creates temp `.sendme-recv-*` directory for blob storage
4. Downloads collection via `execute_get()` with progress tracking
5. Exports to current directory (or specified output directory)
6. Cleans up temp directory

#### Progress Events

- **`ImportProgress`**: Started/FileStarted/FileProgress/FileCompleted/Completed
- **`ExportProgress`**: Started/FileStarted/FileProgress/FileCompleted/Completed
- **`DownloadProgress`**: Connecting/GettingSizes/Downloading/Completed
- **`ConnectionStatus`**: ClientConnected/ConnectionClosed/RequestStarted/RequestProgress/RequestCompleted

### CLI (`sendme`)

The original CLI (`cli/src/main.rs`) is a thin wrapper around `sendme-lib`:

- Uses `clap` derive macros for argument parsing
- Delegates to `sendme_lib::send` and `sendme_lib::receive`
- Uses `indicatif` for multi-progress bars in terminal

### Tauri Desktop App

The desktop app (`app/`) has two parts:

#### Frontend (`app/src/`)

- **Vue 3** with Composition API (`<script setup>`)
- **shadcn/ui** components built on **reka-ui** (Radix Vue)
- **Tailwind CSS v4** for styling
- **TypeScript** with `vue-tsc` checking

Key files:

- **`App.vue`**: Main UI with Send/Receive tabs and transfers list
- **`lib/commands.ts`**: Type-safe wrappers for Tauri commands
- **`components/ui/`**: shadcn/ui components (Button, Input, Tabs, Popover, Progress, etc.)

#### Backend (`app/src-tauri/src/`)

- **`lib.rs`**: Tauri commands that wrap `sendme-lib` functions
- Uses `tokio::sync::RwLock<HashMap>` for transfer state management
- Emits progress events to frontend via `app.emit("progress", update)`
- Registered plugins: `tauri_plugin_dialog`

Tauri Commands:

- **`send_file`**: Spawns send task, returns ticket string
- **`receive_file`**: Spawns receive task, returns result JSON
- **`cancel_transfer`**: Sends abort signal via oneshot channel
- **`get_transfers`**: Returns list of all transfers
- **`get_transfer_status`**: Returns status string for specific transfer

### Browser WASM (`sendme-browser`)

The browser crate (`browser/`) provides WebAssembly bindings for in-browser P2P file transfer:

**IMPORTANT**: The browser crate is **excluded from the workspace** to prevent WASM-incompatible dependencies (like `mio`) from being pulled in. It has its own `[workspace]` section in `Cargo.toml`.

#### Build Requirements

```bash
# macOS: Use llvm.org Clang (NOT Apple Clang)
export CC=/opt/homebrew/opt/llvm/bin/clang

# Build from repository root
cargo build --target=wasm32-unknown-unknown --manifest-path=browser/Cargo.toml

# Or from browser directory
cd browser
cargo build --target=wasm32-unknown-unknown
pnpm run build  # Uses npm scripts
```

#### Structure

- **`src/lib.rs`**: Main entry point, exports `SendmeNode`
- **`src/node.rs`**: Core `SendmeNode` implementation using `iroh::Endpoint::builder().bind()`
  - Uses `MemStore` for in-memory blob storage
  - Creates proper `BlobTicket` with endpoint addressing
  - Implements P2P fetching via `get_hash_seq_and_sizes`
  - Uses JavaScript `setTimeout` for WASM-compatible async sleeping
- **`src/wasm.rs`**: `wasm-bindgen` exports for JavaScript interop
- **`public/index.html`**: Demo web interface with Send/Receive tabs

#### Key Implementation Details

- **Key generation**: Uses `iroh::Endpoint::builder().bind()` which handles key generation internally (WASM-compatible)
- **No `tokio::time::sleep`**: Uses `web_sys::window().set_timeout()` via `JsFuture` instead
- **Workspace exclusion**: Has `[workspace]` section to prevent dependency conflicts
- **No `rand`/`getrandom`**: Removed unused crypto dependencies after switching to `Endpoint::builder().bind()`

#### JavaScript API

```javascript
import init, { SendmeNodeWasm } from "./wasm/sendme_browser.js";

await init();
const node = await SendmeNodeWasm.spawn();

// Check endpoint status
const ready = await node.wait_for_ready(5000);

// Send file (create ticket)
const ticket = await node.import_and_create_ticket(filename, dataArray);

// Receive file (fetch from ticket)
const data = await node.get(ticketString);
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

### Router Keep-Alive

Critical: The sender's router must stay alive to serve incoming connections. This is done by:

```rust
tokio::spawn(async move {
    let _router = router;
    std::future::pending::<()>().await;  // Runs forever
});
```

Do NOT replace this with a sleep loop or the router will drop.

### Progress Channels

- Use `tokio::sync::mpsc::channel(32)` for progress event streaming
- Sender spawns task to consume events and emit to frontend
- Frontend uses `listen("progress", callback)` to receive events

### Abort Handling

- Each transfer has `Option<tokio::sync::oneshot::Sender<()>>` for abort
- Cancel sends `()` through channel, task listens via `abort_rx.await`
- Transfer state tracks abort sender to enable cancellation

### Path Handling

- All temp directories use `.sendme-*` prefix
- `canonicalized_path_to_string()`: Platform-agnostic path conversion
- Validates path components to prevent directory traversal

### Ticket Types

- **`Id`**: Smallest ticket, requires DNS discovery
- **`Relay`**: Uses relay server only
- **`Addresses`**: Direct addresses only
- **`RelayAndAddresses`**: Both relay and direct (default, most reliable)

## MSRV

Minimum Supported Rust Version: **1.81** (defined in workspace Cargo.toml)
