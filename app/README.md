# Tauri + SolidJS + TypeScript

This Tauri desktop application provides a modern GUI for PiSend file transfers, built with SolidJS and TypeScript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [SolidJS](https://marketplace.visualstudio.com/items?itemName=amnedelka.styled-jsx-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Features

- **CLI Tool**: Send files from command line
- **Desktop App**: Tauri-based GUI with SolidJS + Tailwind CSS v4
- **Mobile Support**: Android and iOS apps
- **Nearby Discovery**: mDNS-based local network device discovery
- **Device Model Detection**: Shows actual device names on mobile (e.g., "iPhone 13 Pro", "Samsung SM-G998B")
- **Theme Support**: Light/dark/system theme with smooth transitions

# Installation

## CLI

```bash
cargo install pisend
```

## Desktop App

```bash
cd app
pnpm install
pnpm run tauri dev
```

## Mobile (Android/iOS)

See [Mobile Development](#mobile-development) below.

# Usage

## CLI Usage

### Send side

```bash
pisend send <file or directory>
```

This will create a temporary [iroh](https://crates.io/crates/iroh) node that
serves the content in the given file or directory. It will output a ticket that
can be used to get the data.

The provider will run until it is terminated using `Control-C`. On termination, it
will delete the temporary directory.

### Receive side

```bash
pisend receive <ticket>
```

This will download the data and create a file or directory named like the source
in the **current directory**.

It will create a temporary directory in the current directory, download the data
(single file or directory), and only then move these files to the target
directory.

On completion, it will delete the temp directory.

All temp directories start with `.pisend-`.

## Desktop App Usage

The desktop app provides three modes:

1. **Send**: Select files/directories and generate tickets
2. **Receive**: Enter tickets to download files
3. **Nearby**: Discover devices on local network and send directly

## Mobile Development

### Prerequisites

- Rust 1.81+
- Node.js & pnpm
- Android Studio (for Android)
- Xcode (for iOS, macOS only)

### Android Setup

1. Install Android NDK (via Android Studio SDK Manager)
2. Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export NDK_HOME="$HOME/Library/Android/sdk/ndk/<version>"
export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang"
export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
export CXX_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang++"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_AR="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
```

3. Reload shell: `source ~/.zshrc`

### Building

```bash
cd app
pnpm install
pnpm run tauri android build --target aarch64
```

Output:

- APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- AAB: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

### iOS Setup

```bash
cd app
pnpm run tauri ios build
```

# Development

```bash
# Desktop dev
cd app && pnpm run tauri dev

# Android dev
cd app && pnpm run tauri android dev

cp /Users/sternelee/www/github/iroh-sendme/app/src-tauri/android-includes/pisend/leechat/app/FileUtils.kt /Users/sternelee/www/github/iroh-sendme/app/src-tauri/gen/android/app/src/main/java/pisend/leechat/app/ && ls -la /Users/sternelee/www/github/iroh-sendme/app/src-tauri/gen/android/app/src/main/java/pisend/leechat/app/

# iOS dev (macOS only)
cd app && pnpm run tauri ios dev
```

# Tech Stack

- **Frontend**: SolidJS with TypeScript
- **Styling**: Tailwind CSS v4
- **Backend**: Rust (Tauri v2)
- **Icons**: Lucide Solid
- **Toast Notifications**: solid-sonner
- **QR Codes**: qrcode
