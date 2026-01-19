# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Project Overview

Sendme is a Rust CLI + Tauri desktop app for P2P file transfer using the [iroh](https://crates.io/crates/iroh) networking library. The Cargo workspace includes:
- `lib/` - Core library with send/receive/nearby functionality
- `cli/` - CLI binary
- `app/src-tauri/` - Tauri backend
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
cargo build -p sendme-lib
cargo build -p sendme
cargo build -p app

# Format (REQUIRED before committing)
cargo fmt --all
cargo fmt --all -- --check  # Check only

# Lint (warnings are errors in CI)
cargo clippy --locked --workspace --all-targets --all-features

# Run tests
cargo test --locked --workspace --all-features                    # All tests
cargo test --lib                    # Library unit tests only
cargo test -p sendme-lib           # Tests for library crate only
cargo test send_recv_file          # Run specific test by name

# Run specific test by name
cargo test --test cli               # Run integration test file
cargo test send_recv_file           # Run specific test function
cargo test send_recv_dir            # Another test function example
cargo test --lib                    # Run library unit tests only
cargo test -p sendme-lib            # Run tests for library crate only

# Check dependencies are correct
cargo check --workspace --all-features --bins
```

### Tauri App Commands

```bash
cd app
pnpm install                       # Install dependencies
pnpm run tauri dev                 # Dev server with hot reload
pnpm run build                     # Build frontend (TypeScript + Vite)
pnpm run tauri build               # Build complete desktop app

# Mobile builds
pnpm run tauri android build
pnpm run tauri ios build
```

### Browser WASM Build (Separate)

```bash
cd browser
export CC=/opt/homebrew/opt/llvm/bin/clang  # macOS: Use LLVM Clang
cargo build --target=wasm32-unknown-unknown
pnpm run build
```

## Code Style Guidelines

### Rust

**Imports** (ordered groups, blank lines between):
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

**Naming Conventions:**
- Types: `PascalCase` (`SendResult`, `NearbyDevice`)
- Functions: `snake_case` (`send_with_progress`)
- Constants: `SCREAMING_SNAKE_CASE` (`MSRV`, `ALPN`)
- Modules: `snake_case` (`send`, `receive`)
- Type aliases: `PascalCase` for types, snake_case suffix for semantics

**Documentation:**
```rust
//! Module-level documentation.

/// Brief description. Returns X, does Y.
pub fn my_function() -> Result<T> { ... }
```

**Error Handling:**
```rust
anyhow::bail!("custom error message");
anyhow::ensure!(condition, "error message");
.context("additional context")?
.map_err(|e| format!("Failed: {}", e))?  // For Tauri commands
```

**Async Patterns:**
- `tokio::sync::mpsc::channel(32)` for progress events
- `tokio::sync::oneshot::channel()` for abort signals
- `tokio::sync::RwLock` for shared state (NOT `std::sync::RwLock`)
- **CRITICAL**: Keep routers alive with `std::future::pending::<()>().await`

### TypeScript/Vue

```typescript
// External packages first, then local imports
import { invoke } from "@tauri-apps/api/core";
import { ref, computed } from "vue";
import { send_file, type SendFileRequest } from "@/lib/commands";

// Explicit types for refs
const devices = ref<NearbyDevice[]>([]);

// Vue components: <script setup lang="ts">
// Explicit type annotations on refs/reactive state
// Type event emits: defineEmits<{ close: [] }>()
```

## Important Details

- **MSRV**: 1.81 (Minimum Supported Rust Version)
- **CI**: `RUSTFLAGS: -Dwarnings` (all warnings are errors)
- **Package Manager**: Use **pnpm** for all JS/TS operations
- **Path Handling**: All temp directories use `.sendme-*` prefix
- **Nearby Discovery**: Uses mDNS, requires same WiFi network

## Common Pitfalls

1. **Router keep-alive**: Don't remove `std::future::pending()` - it's critical for send functionality
2. **Browser WASM**: Never add browser crate to workspace members
3. **TypeScript strict**: All code must pass `vue-tsc --noEmit`
4. **Path validation**: Always validate user paths for security
5. **Tauri errors**: Convert Rust errors to String with descriptive messages

## File References

Use `path:line` format (e.g., `lib/src/send.rs:265`).
