# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a Rust CLI tool for P2P file transfer using the [iroh](https://crates.io/crates/iroh) networking library. This fork adds a Tauri desktop app with Vue 3 + shadcn/ui frontend. The project has a Cargo workspace with: `lib/` (core library), `cli/` (CLI binary), `app/src-tauri/` (Tauri backend), and `browser/` (WASM, excluded from workspace).

**Package Manager:** Use **pnpm** for all JavaScript/TypeScript operations (NOT npm or yarn).

## Build, Lint, and Test Commands

### Rust (All Workspace Members)

```bash
# Build all workspace members
cargo build
cargo build --release

# Build specific packages
cargo build -p sendme-lib
cargo build -p sendme
cargo build -p app

# Format code (REQUIRED before committing)
cargo fmt --all

# Check formatting without modifying
cargo fmt --all -- --check

# Lint with Clippy (REQUIRED, warnings treated as errors in CI)
cargo clippy --locked --workspace --all-targets --all-features

# Run all tests
cargo test --locked --workspace --all-features

# Run specific test by name
cargo test --test cli               # Run integration test file
cargo test send_recv_file           # Run specific test function
cargo test send_recv_dir            # Another test function example
cargo test --lib                    # Run library unit tests only
cargo test -p sendme-lib            # Run tests for library crate only

# Check dependencies are correct
cargo check --workspace --all-features --bins
```

### Tauri Desktop App

```bash
cd app
pnpm install                       # Install dependencies
pnpm run tauri dev                 # Start dev server with hot reload
pnpm run build                     # Build frontend (TypeScript check + Vite)
pnpm run tauri build               # Build complete desktop app

# Mobile builds
pnpm run tauri android build
pnpm run tauri ios build
```

### Browser WASM (Excluded from Workspace)

```bash
# IMPORTANT: Build separately from workspace root or browser directory
cd browser
export CC=/opt/homebrew/opt/llvm/bin/clang  # macOS: Use LLVM Clang
cargo build --target=wasm32-unknown-unknown
pnpm run build                     # Full WASM build with wasm-bindgen
```

## Code Style Guidelines

### Rust Code Style

#### Imports

Group imports in this order, separated by blank lines:
1. Standard library (grouped with `{ }`)
2. External crates (one per line)
3. Local crate modules

```rust
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use anyhow::Context;
use iroh::{Endpoint, RelayMode};
use iroh_blobs::{BlobFormat, BlobsProtocol};
use tokio::select;

use crate::{progress::*, types::*};
```

#### Naming Conventions

- **Types**: PascalCase (`SendResult`, `NearbyDevice`, `ProgressEvent`)
- **Functions**: snake_case (`send_with_progress`, `get_or_create_secret`)
- **Constants**: SCREAMING_SNAKE_CASE (`MSRV`, `ALPN`)
- **Modules**: snake_case (`send`, `receive`, `progress`)
- **Type aliases**: PascalCase for types, snake_case suffix for semantics
  ```rust
  pub type ProgressSenderTx = tokio::sync::mpsc::Sender<ProgressEvent>;
  type Transfers = Arc<RwLock<HashMap<String, TransferState>>>;
  ```

#### Documentation

```rust
//! Module-level documentation with description.
//!
//! Additional context and usage notes.

/// Brief description of what function does.
///
/// Additional details if needed. Returns X, does Y.
pub fn my_function() -> Result<T> { ... }
```

#### Error Handling

Use `anyhow::Result<T>` throughout. Common patterns:

```rust
// Early return with custom error
anyhow::bail!("can not share from the current directory");

// Assertion with error message
anyhow::ensure!(condition, "path components must not contain /");

// Add context to errors
.context("invalid hex in secret")?

// For Tauri commands, convert to String errors
.map_err(|e| format!("Failed to read file: {}", e))?
```

#### Async Patterns

- Use `tokio::sync::mpsc::channel(32)` for progress event streaming
- Use `tokio::sync::oneshot::channel()` for abort signals
- Use `tokio::sync::RwLock` for shared state (NOT `std::sync::RwLock`)
- Use `tokio::select!` for concurrent operations
- **CRITICAL**: Keep routers alive with `std::future::pending::<()>().await`
  ```rust
  tokio::spawn(async move {
      let _router = router;
      std::future::pending::<()>().await;  // Runs forever
  });
  ```

### TypeScript/Vue Code Style

#### Imports

```typescript
// External packages first
import { invoke } from "@tauri-apps/api/core";
import { ref, computed } from "vue";

// Local imports
import { send_file, type SendFileRequest } from "@/lib/commands";
```

#### Type Annotations

- Use explicit types for refs: `const devices = ref<NearbyDevice[]>([])`
- Export interfaces for data structures
- Use JSDoc comments for exported functions
- Explicit return types on async functions

```typescript
export interface TransferInfo {
  id: string;
  transfer_type: "send" | "receive";
  status: string;
}

/**
 * Send a file or directory and return the ticket
 */
export async function send_file(request: SendFileRequest): Promise<string> {
  return await invoke("send_file", { request });
}
```

#### Vue Components

- Use `<script setup lang="ts">` (Composition API)
- Explicit type annotations on refs and reactive state
- Use computed properties for derived state
- Type event emits: `defineEmits<{ close: [] }>()`

## Important Implementation Details

### Path Handling

- All temp directories use `.sendme-*` prefix
- Use `canonicalized_path_to_string()` for platform-agnostic conversion
- Validate path components to prevent directory traversal

### Nearby Device Discovery

- **WiFi Required**: Nearby discovery uses mDNS and only works when devices are connected to the same WiFi network
- Uses `iroh::discovery::mdns::MdnsDiscovery` for local network discovery
- Creates endpoint with `RelayMode::Disabled` for local-only transfers
- Broadcasts hostname for device identification

### Browser WASM Build

- **Workspace exclusion**: Browser crate has own `[workspace]` section
- **macOS**: Use LLVM Clang, NOT Apple Clang (`export CC=/opt/homebrew/opt/llvm/bin/clang`)
- **No tokio::time::sleep**: Use `web_sys::window().set_timeout()` instead
- Uses `MemStore` for in-memory storage, `Endpoint::builder().bind()` for key generation

### CI Requirements

- MSRV: **1.81** (Minimum Supported Rust Version)
- `RUSTFLAGS: -Dwarnings` (all warnings are errors)
- Must pass: `cargo fmt --check`, `cargo clippy`, `cargo test`
- Tests run on: Ubuntu, macOS, Windows (GNU & MSVC) with stable, beta, nightly

## Package Manager

Use **pnpm** for all JavaScript/TypeScript operations (NOT npm or yarn).

## Common Pitfalls

1. **Don't use `cd && command`**: The router keep-alive pattern is critical for send functionality
2. **Don't replace `std::future::pending()`**: This is intentional, not a sleep loop
3. **Browser crate isolation**: Never add browser to workspace members
4. **TypeScript strict mode**: All code must pass `vue-tsc --noEmit`
5. **Path validation**: Always validate user-provided paths for security
6. **Tauri error handling**: Convert Rust errors to String with descriptive messages

## File References

When discussing code, reference specific locations using `path:line` format (e.g., `lib/src/send.rs:265`).
