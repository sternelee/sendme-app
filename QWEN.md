# QWEN.md - Sendme Project Context

## Project Overview

**Sendme** is a modern **P2P (peer-to-peer) file transfer system** built with the [iroh](https://crates.io/crates/iroh) networking library. It provides secure, encrypted file transfer with automatic NAT hole punching and relay fallback support.

### Key Features
- **Truly P2P**: Direct connections with automatic NAT traversal, no central server required
- **Secure**: End-to-end TLS encryption with blake3 content verification
- **Cross-platform**: CLI, Desktop (Tauri), Mobile (iOS/Android), and WASM browser
- **Resumable transfers**: Interrupted downloads can be resumed
- **Progress tracking**: Real-time progress updates for all transfers
- **Multiple UI modes**: Interactive TUI (ratatui), modern desktop GUI (SolidJS + Tailwind CSS v4)

### Workspace Version
- **Version**: 0.1.3
- **Edition**: 2021
- **MSRV (Minimum Supported Rust Version)**: 1.81

---

## Architecture

### Cargo Workspace Structure

```
sendme-app/
├── lib/                    # sendme-lib - Core library
├── cli/                    # sendme CLI binary with TUI
├── app/src-tauri/          # Tauri desktop/mobile backend
└── browser-lib/            # WASM bindings (SEPARATE workspace)
```

**Important**: `browser-lib/` is NOT part of the main Cargo workspace to avoid WASM-incompatible dependencies. Build it separately.

### Core Library (`lib/`)

| Module | Purpose |
|--------|---------|
| `lib.rs` | Public API, `get_or_create_secret()`, `canonicalized_path_to_string()` |
| `send.rs` | Send/host - endpoint creation, file import, blob storage, keep-alive |
| `receive.rs` | Receive/download - ticket parsing, connection, download, export |
| `import.rs` | File/directory import into blob store (parallelized) |
| `export.rs` | Export from blob store to filesystem |
| `progress.rs` | Progress event types and channels |
| `types.rs` | Common types (`AddrInfoOptions`, `CommonConfig`, `Format`, `RelayModeOption`) |
| `nearby/` | mDNS-based nearby device discovery |

### Tauri App (`app/`)

- **Frontend**: SolidJS + TypeScript + Tailwind CSS v4 (`app/src/`)
- **Backend**: Tauri commands wrapping `sendme-lib` (`app/src-tauri/src/`)
- **State management**: `tokio::sync::RwLock<HashMap>` for transfer state
- **Progress events**: Emitted via `app.emit("progress", update)`

### CLI Tool (`cli/`)

- Binary name: `sendme`
- Interactive TUI built with ratatui
- Clipboard support for tickets
- QR code generation

---

## Building and Running

### Rust Commands

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p sendme-lib      # Library only
cargo build -p cli             # CLI only (produces 'sendme' binary)
cargo build -p app             # Tauri backend only

# Format (REQUIRED before committing)
cargo fmt --all

# Lint with Clippy (warnings = errors in CI)
cargo clippy --locked --workspace --all-targets --all-features
```

### Running Tests

```bash
# All workspace tests
cargo test --locked --workspace --all-features

# Run specific test by name pattern
cargo test send_recv_file
cargo test transfer_file

# Run integration tests only
cargo test --test cli

# Verbose output for debugging
cargo test send_recv_file -- --nocapture

# Run with staging relays (like CI)
IROH_FORCE_STAGING_RELAYS=1 cargo test
```

### Tauri Desktop App

```bash
cd app
pnpm install                       # Install dependencies
pnpm run dev                       # Vite dev server
pnpm run tauri dev                 # Dev with hot reload
pnpm run build                     # Build frontend only
pnpm run tauri build               # Build complete desktop app
pnpm run format                    # Prettier formatting

# Mobile builds
pnpm run tauri android build
pnpm run tauri ios build
```

### Browser WASM Build (Separate - NOT in workspace)

```bash
cd browser-lib
# macOS: Use LLVM Clang
export CC=/opt/homebrew/opt/llvm/bin/clang
cargo build --target=wasm32-unknown-unknown --release
```

### CLI Installation (Quick)

```bash
curl -sSL https://raw.githubusercontent.com/sternelee/sendme-app/main/install.sh | bash
```

---

## Development Conventions

### Rust Import Order

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

| Element | Convention | Example |
|---------|-----------|---------|
| Types/Structs/Enums | `PascalCase` | `SendResult`, `NearbyDevice` |
| Functions/Methods | `snake_case` | `send_with_progress`, `get_or_create_secret` |
| Constants | `SCREAMING_SNAKE_CASE` | `MSRV`, `ALPN`, `TICK_RATE_MS` |
| Modules | `snake_case` | `send`, `receive`, `progress` |
| Enum variants | `PascalCase` | `AddrInfoOptions::RelayAndAddresses` |

### TypeScript/SolidJS Style

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { send_file, type SendFileRequest } from "~/lib/commands";

// Use ~/* alias for src/ imports (configured in tsconfig.json)
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
// Shared state - use tokio RwLock, NOT std::sync::RwLock
tokio::sync::RwLock<HashMap<String, State>>

// CRITICAL: Keep routers alive in async contexts
std::future::pending::<()>().await  // Never remove this!
```

---

## Key Dependencies

### Rust
- `iroh` 0.95 - Core networking library
- `iroh-blobs` 0.97 - Content-addressed storage
- `tokio` 1.34 - Async runtime
- `anyhow` - Error handling
- `clap` - CLI argument parsing
- `ratatui` - Terminal UI
- `tauri` 2 - Desktop/mobile framework
- `wasm-bindgen` - WASM bindings

### JavaScript/TypeScript
- `solid-js` - Frontend framework
- `@solidjs/router` - Routing
- `vinxi` - Bundler
- `tailwindcss` 4 - Styling
- `lucide-solid` - Icon library
- `solid-sonner` - Toast notifications

**Package Manager**: Always use **pnpm** for JavaScript/TypeScript operations (NOT npm or yarn).

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `IROH_SECRET` | Hex-encoded 32-byte secret key (optional, generates random if not set) |
| `IROH_FORCE_STAGING_RELAYS` | Set to `1` to use staging relays (used in CI tests) |
| `RUST_LOG` | Tracing level: `debug`, `info`, `warn`, `error` |

---

## CI/CD

- **GitHub Actions**: Configured in `.github/workflows/release.yml`
- **Linting**: `RUSTFLAGS=-Dwarnings` (all warnings are errors)
- **Tests**: Run with `IROH_FORCE_STAGING_RELAYS=1` (staging relays)

---

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - it's critical for send functionality
2. **Browser WASM**: Never add `browser-lib` to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`
6. **Android temp directories**: Use `args.common.temp_dir` instead of `std::env::current_dir()`
7. **Recursion limit**: If compilation fails, add `#![recursion_limit = "256"]` to `app/src-tauri/src/lib.rs`
8. **Android JNI**: Always use `push_local_frame()`/`pop_local_frame()` in loops
9. **Android content URIs**: Handle `content://` URIs specially in Tauri

---

## Release Profile

Optimized for binary size:

```toml
[profile.release]
panic = "abort"
opt-level = "s"
codegen-units = 1
lto = true
debug = "none"
strip = true
```

---

## Licenses

Dual-licensed under your choice of:
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

Original project by [n0-computer](https://github.com/n0-computer/sendme), forked and enhanced with desktop/mobile support.
