# Sendme Browser App

A modern SolidJS web application for P2P file transfer using [iroh](https://iroh.computer) networking. Features a cosmic gradient UI with glass morphism effects and WebAssembly-powered file transfers.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build WASM module (debug)
pnpm run build:wasm

# Start development server
pnpm run dev
```

Visit `http://localhost:3000` to use the app.

## Platform-Specific Requirements

### macOS

macOS users need to use **llvm.org Clang** (NOT Apple Clang) for WASM builds:

```bash
# Install llvm from Homebrew
brew install llvm

# Set CC environment variable
export CC=/opt/homebrew/opt/llvm/bin/clang

# Then build as normal
pnpm run build:wasm
```

### Windows

Install the following:
- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) (v22+)
- [LLVM](https://releases.llvm.org/) - Add to PATH after installation
- [Make](https://gnuwin32.sourceforge.net/packages/make.htm) (optional, for Windows Build Tools)

```powershell
# In PowerShell, set CC to use clang
$env:CC = "clang"

# Then build
pnpm run build:wasm
```

### NixOS

Add the following to your `flake.nix` or `shell.nix`:

```nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    rustc
    cargo
    nodejs
    llvm
    clang
    wasm-bindgen-cli
  ];

  shellHook = ''
    export CC=${pkgs.clang}/bin/clang
  '';
}
```

## Build Commands

```bash
# Debug WASM build (faster compilation, larger file)
pnpm run build:wasm

# Release WASM build (slower compilation, optimized file)
pnpm run build:wasm:release

# Build the SolidJS app
pnpm run build

# Deploy to Cloudflare Workers
pnpm run deploy
```

## Architecture

### Tech Stack

- **SolidJS** - Reactive UI framework
- **SolidStart** - Full-stack framework with SSR
- **Tailwind CSS v4** - Utility-first styling
- **solid-toast** - Toast notifications
- **solid-icons** - Tabler Icons for UI

### WASM Integration

The app uses WebAssembly bindings from `browser-lib` crate:

```typescript
import { initWasm, sendFile, receiveFile } from "./lib/commands";

// Initialize WASM module
await initWasm();

// Send a file
const ticket = await sendFile(file);

// Receive a file
const { filename, data } = await receiveFile(ticket);
```

### Key Components

- **`src/routes/index.tsx`** - Main page with Send/Receive tabs
- **`src/components/sendme/SendTab.tsx`** - File sending with drag & drop
- **`src/components/sendme/ReceiveTab.tsx`** - File receiving via ticket
- **`src/lib/commands.ts`** - WASM integration layer

### Data Flow

```
User selects file
    ↓
sendFile(file) in commands.ts
    ↓
SendmeNodeWasm.import_and_create_ticket()
    ↓
WASM module processes file
    ↓
Returns ticket string
    ↓
User shares ticket
```

## Development

### File Structure

```
browser-app/
├── public/
│   └── wasm/              # Generated WASM files (DO NOT edit)
├── src/
│   ├── components/
│   │   └── sendme/        # Send/Receive components
│   ├── lib/
│   │   └── commands.ts    # WASM integration
│   ├── routes/
│   │   └── index.tsx      # Main page
│   ├── app.css            # Cosmic gradient theme
│   └── app.tsx            # App root
└── package.json
```

### Adding Features

1. **New component**: Add to `src/components/`
2. **New route**: Add to `src/routes/`
3. **WASM functions**: Add to `browser-lib/src/` then rebuild WASM

### Vite Configuration

The app uses special Vite plugins for WASM support:

```typescript
// app.config.ts
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  vite: {
    plugins: [tailwindcss(), wasm(), topLevelAwait()]
  }
});
```

## Troubleshooting

### WASM Import Errors

**Error**: `Cannot import non-asset file`

**Solution**: WASM files are in `src/wasm/` (not `public/wasm/`) after build.

### LocalStorage SSR Errors

**Error**: `localStorage is not defined`

**Solution**: The app only runs in browser context. WASM initialization happens client-side.

### Build Failures

**Error**: `linking with cc failed`

**Solution**: Ensure you have the correct compiler:
- macOS: Use llvm.org Clang, NOT Apple Clang
- Windows: Install LLVM and add to PATH
- Linux: Install clang and wasm32-unknown-unknown target

### Endpoint Not Ready

**Error**: `Endpoint not ready`

**Solution**: The WASM module needs time to initialize. The app automatically waits up to 5 seconds.

## Deployment

### Cloudflare Workers

```bash
pnpm run deploy
```

Requires `wrangler` authentication.

### Static Hosting

```bash
pnpm run build
# Output in .solid/output/
```

Deploy to any static host (Vercel, Netlify, GitHub Pages).

## License

MIT OR Apache-2.0
