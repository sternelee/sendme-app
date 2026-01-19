# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a Rust CLI + Tauri desktop app for P2P file transfer using the [iroh](https://crates.io/crates/iroh) networking library. The Cargo workspace includes:
- `lib/` - Core library (`sendme-lib`) with send/receive/nearby functionality
- `cli/` - CLI binary (`sendme`) with ratatui TUI
- `app/src-tauri/` - Tauri backend for desktop/mobile
- `tauri-plugin-mobile-file-picker/` - Mobile file picker plugin
- `browser/` - WASM build (excluded from workspace, build separately)

**Package Manager:** Use **pnpm** for all JavaScript/TypeScript operations (NOT npm or yarn).

## Build, Lint, and Test Commands

### Rust Commands

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p sendme-lib      # Library only
cargo build -p sendme          # CLI only (binary name: sendme)
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
cargo test -p sendme-lib                     # Library tests only
cargo test -p cli                            # CLI tests only

# Run integration tests only
cargo test --test cli                        # tests/cli.rs

# Run library unit tests only
cargo test --lib -p sendme-lib

# Verbose output for debugging
cargo test send_recv_file -- --nocapture
```

### Tauri App Commands

```bash
cd app
pnpm install                       # Install dependencies
pnpm run dev                       # Vite dev server
pnpm run tauri dev                 # Dev with hot reload
pnpm run build                     # Build frontend (vue-tsc --noEmit && vite build)
pnpm run tauri build               # Build complete desktop app

# Mobile builds
pnpm run tauri android build
pnpm run tauri ios build
```

### Browser WASM Build (Separate - NOT in workspace)

```bash
cd browser
export CC=/opt/homebrew/opt/llvm/bin/clang  # macOS: Use LLVM Clang
cargo build --target=wasm32-unknown-unknown
pnpm run build
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

### TypeScript/Vue Style

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { ref, computed } from "vue";
import { send_file, type SendFileRequest } from "@/lib/commands";

// Explicit types for refs
const devices = ref<NearbyDevice[]>([]);
const isLoading = ref<boolean>(false);

// Vue components use <script setup lang="ts">
// Type event emits: defineEmits<{ close: [], update: [value: string] }>()
```

## Important Details

- **MSRV**: 1.81 (Minimum Supported Rust Version)
- **CI Environment**: `RUSTFLAGS: -Dwarnings` (all warnings are errors)
- **CI Environment**: `IROH_FORCE_STAGING_RELAYS: 1` (use staging relays in tests)
- **TypeScript**: Strict mode enabled, all code must pass `vue-tsc --noEmit`
- **Path Handling**: All temp directories use `.sendme-*` prefix
- **Nearby Discovery**: Uses mDNS, requires same WiFi network

## Common Pitfalls

1. **Router keep-alive**: Never remove `std::future::pending()` - critical for send functionality
2. **Browser WASM**: Never add browser crate to workspace members (conflicts with native builds)
3. **Tauri errors**: Convert Rust errors to String with descriptive messages for frontend
4. **Path validation**: Always validate user paths (see `canonicalized_path_to_string`)
5. **Android content URIs**: Handle `content://` URIs specially in Tauri (see `app/src-tauri/src/lib.rs`)
6. **Tokio RwLock**: Use `tokio::sync::RwLock` for shared async state, not `std::sync::RwLock`

## File References

Use `path:line` format for code references (e.g., `lib/src/send.rs:42`).

## Project Structure

```
├── lib/src/           # Core library
│   ├── lib.rs         # Public API exports
│   ├── send.rs        # Send functionality
│   ├── receive.rs     # Receive functionality
│   ├── types.rs       # Core types (SendArgs, ReceiveArgs, etc.)
│   └── progress.rs    # Progress reporting
├── cli/src/           # CLI with TUI
│   ├── main.rs        # Entry point
│   └── tui/           # Ratatui TUI components
├── app/               # Tauri desktop/mobile app
│   ├── src/           # Vue frontend
│   └── src-tauri/     # Rust backend
└── tests/cli.rs       # Integration tests
```
