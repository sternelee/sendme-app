# GEMINI.md - Project Context & Instructions

## Project Overview
**Sendme** is a modern, secure, peer-to-peer (P2P) file transfer solution built on the [iroh](https://iroh.computer/) networking library. It provides a complete ecosystem for file sharing across multiple platforms.

### Architecture
- **Core Library (`lib/`)**: `sendme-lib` - The engine for sending and receiving files, handling iroh endpoints, tickets, and progress tracking.
- **CLI (`cli/`)**: A terminal-based interactive UI built with `ratatui` for fast P2P transfers.
- **Desktop/Mobile App (`app/`)**: A cross-platform application built with **Tauri v2** and **SolidJS**. Supports Windows, macOS, Linux, iOS, and Android.
- **Web App (`browser/`)**: A **SolidStart** application deployed to Cloudflare Workers, featuring WASM-based P2P transfers.
- **Browser Library (`browser-lib/`)**: A specialized Rust crate for WebAssembly, providing P2P capabilities to the browser.

### Key Technologies
- **Networking**: `iroh`, `iroh-blobs`
- **Rust**: Workspace for core logic, CLI, and Tauri backend.
- **Frontend**: SolidJS, Tailwind CSS v4, TypeScript.
- **Desktop/Mobile**: Tauri v2.
- **Web/Serverless**: SolidStart, Cloudflare Workers, D1 Database, Wrangler.

---

## Building and Running

### Prerequisites
- **Rust**: 1.81+
- **Node.js**: 22+
- **pnpm**: `npm install -g pnpm`
- **Platform SDKs**: Xcode (iOS), Android Studio/NDK (Android), Tauri dependencies.

### Common Commands

#### Rust Workspace
```bash
# Build everything in the main workspace (lib, cli, app/src-tauri)
cargo build

# Run CLI TUI
cargo run -p cli

# Run tests
cargo test --workspace

# Linting and Formatting
cargo fmt --all
cargo clippy --workspace
```

#### Desktop/Mobile App (Tauri)
```bash
cd app
pnpm install

# Run Desktop Dev Mode
pnpm run tauri dev

# Build for Desktop
pnpm run tauri build

# Build for Mobile
pnpm run tauri ios build
pnpm run tauri android build
```

#### Browser App (SolidStart + WASM)
```bash
cd browser
pnpm install

# Build WASM library first
pnpm run build:wasm

# Run Dev Server
pnpm run dev

# Deploy to Cloudflare
pnpm run deploy
```

---

## Development Conventions

### Coding Style
- **Rust**: Adhere to standard idiomatic Rust. Use `cargo fmt` and `cargo clippy`.
- **Frontend**: SolidJS functional components. Prefer Tailwind CSS v4 for styling.
- **TypeScript**: Strict typing is encouraged.

### Git & Commits
- This is a monorepo. Prefix commit messages with the component name if applicable (e.g., `cli: fix progress bar`, `app: update send screen`).

### Verification
- Always run `cargo test` when modifying the core library or CLI.
- For UI changes in the `app`, verify on both Desktop (Tauri dev) and Web (if applicable).
- Ensure WASM compatibility when modifying `browser-lib`.

### Important Files
- `README.md`: General project documentation.
- `Cargo.toml`: Root Rust workspace configuration.
- `pnpm-workspace.yaml`: JS/TS monorepo configuration.
- `app/src-tauri/tauri.conf.json`: Tauri application configuration.
- `browser/wrangler.jsonc`: Cloudflare Workers configuration.
