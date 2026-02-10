# Sendme

<div align="center">

**🚀 Modern P2P File Transfer - CLI, Desktop & Mobile**

A powerful, secure file transfer tool built with [iroh](https://crates.io/crates/iroh) networking library.

[![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-blue.svg)](LICENSE-MIT)
[![Rust Version](https://img.shields.io/badge/rust-1.81%2B-orange.svg)](https://www.rust-lang.org)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Architecture](#-architecture) • [Development](#-development)

</div>

---

## 📖 Overview

Sendme is a complete file transfer solution that works across **CLI**, **Desktop (Tauri)**, **Mobile (iOS/Android)**, and **Web (WASM)**. Built on the [iroh](https://crates.io/crates/iroh) networking library, it provides truly peer-to-peer file transfer with automatic NAT hole punching, relay fallback, and blake3 verified streaming.

**Key Highlights:**
- 🔒 **Secure**: End-to-end encryption with TLS, blake3 hash verification
- 🌐 **NAT Traversal**: Automatic hole punching with relay fallback
- 📱 **Cross-Platform**: CLI, Desktop (Windows/macOS/Linux), Mobile (iOS/Android), Web
- ⚡ **Resumable**: Interrupted downloads can be resumed
- 🔗 **Location Transparent**: Works with 256-bit node IDs, tickets remain valid if IP changes
- 🎨 **Modern UI**: Beautiful SolidJS + Tailwind CSS v4 interface for desktop/mobile

## ✨ Features

### Core Capabilities
- **P2P File Transfer**: Direct peer-to-peer connections with NAT hole punching
- **Relay Fallback**: Automatic relay server usage when direct connection fails
- **Blake3 Verification**: Cryptographic verification of all transferred data
- **Resumable Downloads**: Interrupted transfers can be resumed from where they stopped
- **Directory Transfer**: Send entire directories while preserving structure
- **Progress Tracking**: Real-time progress updates for all transfers
- **Multiple Ticket Types**: Support for different addressing modes (direct, relay, relay+direct)
- **TUI Interface**: Interactive terminal UI with ratatui (CLI)
- **Modern Desktop App**: Beautiful Tauri-based desktop application
- **Mobile Support**: Native iOS and Android applications
- **WASM Browser**: In-browser P2P file transfer (experimental)

### Security Features
- End-to-end TLS encryption
- Blake3 content verification
- 256-bit node IDs for identity
- No central server required for transfer (P2P)
- Secure ticket-based sharing

## 📦 Installation

### CLI Tool

#### From crates.io (coming soon)
```bash
cargo install sendme
```

#### Build from source
```bash
git clone https://github.com/sternelee/iroh-sendme.git
cd iroh-sendme
cargo build --release -p cli
# Binary will be at: target/release/sendme
```

### Desktop Application

#### Pre-built Releases
Download the latest release for your platform from the [Releases](https://github.com/sternelee/iroh-sendme/releases) page:
- **Windows**: `.msi` installer
- **macOS**: `.dmg` or `.app` bundle
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

#### Build from source
```bash
git clone https://github.com/sternelee/iroh-sendme.git
cd iroh-sendme/app
pnpm install
pnpm run tauri build
```

### Mobile Apps

#### iOS
```bash
cd app
pnpm run tauri ios build
```

#### Android
```bash
cd app
pnpm run tauri android build
```

## 🚀 Usage

### CLI - Terminal Interface

The CLI provides an interactive TUI (Terminal User Interface) for file transfers:

```bash
# Simply run sendme to open the TUI
sendme
```

**TUI Controls:**
- Use `Tab` to switch between Send and Receive tabs
- Enter file/directory path and press `Enter` to send
- Enter ticket string to receive files
- View transfer progress and history in real-time

**Example workflow:**
1. **Sender**: Run `sendme`, enter path to file/directory, get ticket
2. Share the ticket with recipient (copy/paste, QR code, etc.)
3. **Receiver**: Run `sendme`, paste ticket, files download automatically

### Desktop Application

Launch the desktop app and use the intuitive GUI:

**Sending Files:**
1. Click on the "Send" tab
2. Click "Browse" to select a file or directory
3. Click "Send" to generate a ticket
4. Share the ticket via QR code, copy to clipboard, or share sheet

**Receiving Files:**
1. Click on the "Receive" tab
2. Paste the ticket or scan QR code
3. Select output directory (optional)
4. Click "Receive" to start download

**Features:**
- Progress bars with real-time updates
- Transfer history and management
- QR code generation/scanning
- Native file picker
- System notifications

### Library Usage

Integrate Sendme into your Rust project:

```rust
use sendme_lib::{send_with_progress, receive_with_progress, CommonConfig, SendArgs, ReceiveArgs};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Sending a file
    let (tx, mut rx) = mpsc::channel(32);
    let config = CommonConfig::default();
    let args = SendArgs {
        path: "myfile.txt".into(),
        ticket_type: AddrInfoOptions::RelayAndAddresses,
        recursive: false,
    };
    
    let ticket = send_with_progress(args, config, tx).await?;
    println!("Ticket: {}", ticket);
    
    // Monitor progress
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            println!("Progress: {:?}", event);
        }
    });
    
    Ok(())
}
```

### WASM/Browser (Experimental)

```bash
cd browser
pnpm install
pnpm run build
pnpm run serve
```

Open `http://localhost:8080` to use the web interface.

## 🏗 Architecture

### Workspace Structure

This is a Cargo workspace with multiple components:

```
iroh-sendme/
├── lib/                    # Core library (sendme-lib)
│   ├── send.rs            # Send/host functionality
│   ├── receive.rs         # Receive/download functionality
│   ├── import.rs          # File import into iroh-blobs
│   ├── export.rs          # Export from iroh-blobs to filesystem
│   ├── progress.rs        # Progress event types
│   └── types.rs           # Common types and configuration
│
├── cli/                   # CLI binary with TUI (ratatui)
│   ├── main.rs           # CLI entry point
│   └── tui/              # Terminal UI components
│
├── app/                   # Tauri desktop/mobile application
│   ├── src/              # SolidJS frontend (TypeScript + Tailwind CSS v4)
│   ├── src-tauri/        # Rust backend (Tauri commands)
│   └── package.json      # Frontend dependencies (pnpm)
│
├── browser-lib/          # WASM library bindings
│   └── src/              # WebAssembly exports
│
├── tauri-plugin-mobile-file-picker/  # Custom Tauri plugin
│   └── src/              # Unified file picker for desktop/mobile
│
└── browser/              # Web demo (legacy, uses browser-lib)
    └── public/           # Static web assets
```

### Component Descriptions

#### **sendme-lib** - Core Library
The heart of the application, providing:
- **Send Flow**: Endpoint creation → File import → Blob storage → Ticket generation → Router keep-alive
- **Receive Flow**: Ticket parsing → Connection → Download with progress → Export to filesystem
- **Progress Tracking**: Real-time event streaming via channels
- **Import/Export**: Parallel file operations with configurable workers

#### **sendme** - CLI Tool
- Interactive TUI built with ratatui
- Send/Receive tabs with real-time progress
- Transfer history tracking
- Color-coded status indicators

#### **app** - Desktop/Mobile Application
- **Frontend**: SolidJS + TypeScript + Tailwind CSS v4
- **Backend**: Tauri commands wrapping sendme-lib
- **Features**: QR codes, clipboard, notifications, file pickers, theme switching
- **Mobile**: iOS and Android support with native APIs

#### **browser-lib** - WASM Bindings
- In-memory blob storage (MemStore)
- JavaScript Promise-based API
- Supports Collection format for filename preservation

### How It Works

**Send Process:**
1. Import file/directory into content-addressed storage (parallel)
2. Create iroh Endpoint with relay configuration
3. Generate BlobTicket containing endpoint addresses + content hash
4. Serve data via BlobsProtocol, waiting for incoming connections
5. Keep router alive to maintain connectivity

**Receive Process:**
1. Parse BlobTicket to extract sender endpoint and content hash
2. Create local iroh Endpoint
3. Connect to sender using addresses in ticket
4. Download and verify data using blake3 streaming
5. Export to filesystem preserving directory structure

**Network Architecture:**
- Direct P2P connection when possible (hole punching)
- Automatic relay fallback for difficult NATs
- TLS encryption for all connections
- Support for multiple relay servers

## 🛠 Development

### Prerequisites

- **Rust**: 1.81 or later (MSRV)
- **Node.js**: For Tauri frontend (use pnpm as package manager)
- **pnpm**: Required for app development (`npm install -g pnpm`)
- **Platform SDKs**: 
  - macOS: Xcode for iOS builds
  - Android: Android Studio and NDK

### Build Commands

#### Rust Workspace
```bash
# Build all workspace members
cargo build

# Build specific packages
cargo build -p sendme-lib      # Library only
cargo build -p cli             # CLI only
cargo build -p app             # Tauri backend only

# Release builds
cargo build --release

# Format code (required before commits)
cargo fmt --all

# Lint with Clippy
cargo clippy --locked --workspace --all-targets --all-features
```

#### Tauri Desktop App
```bash
cd app
pnpm install                   # Install dependencies
pnpm run tauri dev             # Development mode with hot reload
pnpm run build                 # Build frontend only
pnpm run tauri build           # Build complete desktop app
```

#### WASM Browser
```bash
cd browser-lib
cargo build --target=wasm32-unknown-unknown

cd ../browser
pnpm install
pnpm run build
pnpm run serve
```

### Testing

```bash
# Run all tests
cargo test --workspace

# Run specific test suites
cargo test -p sendme-lib       # Library tests
cargo test --test cli          # CLI integration tests

# Run with verbose output
cargo test -- --nocapture

# Run specific test by name
cargo test send_recv_file
```

### Development Workflow

1. **Make changes** to Rust code or SolidJS frontend
2. **Format code**: `cargo fmt --all`
3. **Lint code**: `cargo clippy --workspace`
4. **Run tests**: `cargo test --workspace`
5. **Test manually**: Run CLI or desktop app
6. **Commit changes** with descriptive message

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

**Areas for contribution:**
- Bug fixes and performance improvements
- Documentation enhancements
- New features (mDNS discovery, streaming, etc.)
- Mobile app improvements
- WASM browser functionality
- UI/UX enhancements

## 📄 License

This project is licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT License ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

## 🙏 Acknowledgments

Built with:
- [iroh](https://github.com/n0-computer/iroh) - Networking library
- [iroh-blobs](https://github.com/n0-computer/iroh) - Content-addressed storage
- [Tauri](https://tauri.app/) - Desktop/mobile framework
- [SolidJS](https://www.solidjs.com/) - Frontend framework
- [ratatui](https://github.com/ratatui-org/ratatui) - Terminal UI
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework

Original project by [n0-computer](https://github.com/n0-computer/sendme), forked and enhanced with desktop/mobile support.
