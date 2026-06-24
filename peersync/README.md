# PeerSync

Peer-to-peer configuration file synchronization over [Iroh](https://iroh.computer).

PeerSync keeps your dotfiles, editor configs, Claude Code settings, and personal documents in sync across Mac, Linux, and Windows machines—without any central server. All transfers are end-to-end encrypted via Iroh's QUIC/TLS stack and content-addressed with BLAKE3.

## Features

- **No central server**: Direct P2P sync with automatic NAT hole punching and relay fallback.
- **End-to-end encryption**: Iroh TLS + BLAKE3 content verification.
- **Bidirectional sync**: Changes on any linked device propagate to the others.
- **Conflict handling**: Last-writer-wins with automatic `.peersync_conflict.*` backups.
- **Tombstone deletes**: Deletions are synced safely, with mtime-aware protection.
- **Echo suppression**: In-flight markers prevent "remote write → local watcher → re-upload" loops.

## Installation

PeerSync is now integrated into the `sendme` CLI. The standalone `peersync` binary has been removed; use the PeerSync tab in the TUI instead.

Build from this repository:

```bash
cargo build --release -p cli
# Binary is at target/release/sendme
```

## Quick Start

Launch the TUI and switch to the PeerSync tab with `[5]`:

```bash
sendme --tui
```

### Configure sync targets

Edit `~/.config/sendme/peersync/config.toml` (created automatically on first run):

```toml
device_name = "macbook-pro"

[sync_targets]
nvim = { src = "~/.config/nvim", ignore = [".git/", "undo/"] }
claude_code = { src = "~/.config/claude-code" }
mcp_servers = { src = "~/Library/Application Support/Claude/claude_desktop_config.json" }
skills_docs = { src = "~/Documents/skills_docs" }
```

### Start the daemon

In the PeerSync tab, press `[Enter]` while viewing **Status** or **Log** to start the sync engine. Press `[Enter]` again to stop it.

On first start, PeerSync scans all targets and uploads their current state. After that, it watches for local changes and listens for remote changes in real time.

## TUI Controls

- `[5]` — switch to PeerSync tab.
- `[s]` — Status section.
- `[l]` — Log section.
- `[g]` — GC section.
- `[r]` — refresh status/log.
- `[Enter]` — start/stop sync engine (Status/Log) or run GC (GC).
- `[d]` — toggle dry-run mode in GC section.

## How It Works

1. Each file under a configured target is hashed with BLAKE3 and imported into the local Iroh blob store.
2. A small JSON metadata record is written to an Iroh doc keyed by `/peersync/files/<target>/<relative_path>`.
3. Iroh docs replicate metadata between linked devices; Iroh blobs transfer the actual file contents on demand.
4. Local file changes are debounced, hashed, and uploaded automatically.
5. Remote changes are applied locally, with conflict backups when the local file is older.

## Conflict Resolution

If two devices edit the same file while offline, the newer file (by mtime) wins. The older local copy is preserved as:

```
<filename>.peersync_conflict.<device_name>.<timestamp>
```

Check the PeerSync Status section and merge these manually.

## Security

- Tickets grant write access to the sync doc. Keep them private.
- All connections use Iroh's TLS; content is verified with BLAKE3.
- No files or metadata are stored on a central server.

## Development

```bash
cargo check -p peersync
cargo test -p peersync
cargo run -p cli -- --tui
```

## Status

PeerSync is a new addition to the sendme-app workspace. The workspace has been upgraded to Iroh 1.0.0 / iroh-blobs 0.103 / iroh-docs 0.101.0.
