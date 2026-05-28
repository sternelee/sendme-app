# Repository Guidelines

## Project Overview

This repo builds Sendme, a cross-platform P2P transfer product on top of `iroh`. For AI work in this repository, the highest-value frontend area is the Tauri app in `app/`: a SolidJS UI over a Rust backend in `app/src-tauri/`.

If you are touching UX, assume the critical journeys are:
- share a file quickly
- receive from a pasted/scanned ticket
- handle incoming nearby/cloud transfers without confusion
- preserve progress, history, and cross-device affordances

## Architecture & Data Flow

### Tauri UI shell
- `app/src/routes/index.tsx` is the main app shell.
- Desktop uses a sticky top nav (`transfer` / `history` / `settings`); mobile uses a bottom dock.
- The screen mounts nearby discovery, loads saved output directory + theme, subscribes to Tauri events, and owns the incoming-transfer modals.

### Share / receive workspace
- `app/src/components/TransferTab.tsx` is the main transfer workspace.
- Upper card = primary mode switch: `send`, `receive`, `text`.
- Lower card = alternate share channels: `nearby`, `devices`, `friends`.
- Right-side/support cards surface “ready to share” context, incoming nearby prompts, and protocol reassurance.

### Send flow UX
1. User selects a file via `DropZone` (`app/src/lib/components/DropZone.tsx`) or enters text.
2. `app/src/components/SendPanel.tsx` writes selection into `GlobalStore`.
3. Ticket generation is automatic:
   - file: immediately on selection
   - text: debounced (~800ms)
4. Backend call goes through `app/src/bindings.ts` → Tauri command (`send_file` / `send_text`).
5. Success state shows a share card with QR, raw ticket, copy, and native share actions.

Important UX behavior: the current design is **auto-generate-first**, not “select file then press Send”. Preserve that unless the task explicitly changes the interaction model.

### Receive flow UX
1. User pastes a ticket or scans QR on mobile in `app/src/components/ReceivePanel.tsx`.
2. Optional destination folder selection is stored in `GlobalStore` and persisted to `localStorage` by the route shell.
3. Receive action calls `receive_file` via `app/src/bindings.ts`.
4. Progress events arrive from the backend on the `progress` Tauri event channel.
5. UI computes smoothed speed/ETA and renders `TransferProgress`.

Important UX behavior: receive is optimized for **paste-and-go**. Clipboard import, QR scan, remembered output path, and immediate progress feedback are part of the intended flow.

### Incoming transfer UX
- Nearby requests are surfaced in two places:
  - inline cue inside `TransferTab`
  - blocking modal in `app/src/routes/index.tsx`
- Cloud tickets use the same `IncomingRequestCard` pattern.
- Accepting a request switches the user into receive mode and hands control to backend-driven progress.

### State ownership
- `app/src/lib/store.tsx` is the central UI state container for send/receive/nearby/cloud flows.
- `app/src/lib/auth.tsx` owns auth/session state.
- `app/src/bindings.ts` is the typed boundary to the Rust backend.
- `app/src-tauri/src/lib.rs` owns transfer state, event emission, nearby runtime, cloud state, and mobile-specific file handling.

## Critical Gotchas

These are mistakes agents commonly make:

- **Router keep-alive (CRITICAL)**: The sender's router must stay alive with `std::future::pending().await`. If dropped, no incoming connections work. Never replace with a sleep loop.
- **Android temp directory**: Always use `CommonConfig.temp_dir` on Android. Apps run sandboxed; assuming current directory breaks file import/export.
- **browser-lib is a separate workspace**: Do not add `browser-lib/` to the root `Cargo.toml` workspace. Its dependencies are not WASM-compatible.
- **app/ and browser/ are separate products**: Both use SolidJS but share no state or build configuration. Code from one does not apply to the other.
- **iOS first-time Xcode setup**: Before `xcodebuild` on a new machine, open the project in Xcode GUI once and confirm the Team. The daemon cannot access credentials without this.
- **iOS entitlements**: `app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements` must remain empty (`<dict></dict>`) for personal-team signing.
- **CI tests require staging relays**: Run `IROH_FORCE_STAGING_RELAYS=1` before `cargo test` in CI environments.

## Key Directories

| Path | Purpose |
| --- | --- |
| `app/src/routes/` | Top-level Tauri screens; `index.tsx` is the main transfer shell |
| `app/src/components/` | UX-level panels such as `TransferTab`, `SendPanel`, `ReceivePanel`, `HistoryPanel` |
| `app/src/lib/components/` | Reusable transfer widgets: `DropZone`, `TransferProgress`, `IncomingRequestCard`, `FileManifest` |
| `app/src/lib/` | Store, auth, cloud API/WebSocket, utility helpers, local UI types |
| `app/src-tauri/src/` | Tauri backend commands and event producers consumed by the UI |
| `lib/src/` | Core Rust transfer engine used by the Tauri backend |
| `packages/shared/` | Shared i18n exports used throughout UI text |
| `packages/ui/` | Shared formatting/display helpers such as display names and file-size formatting |

## Development Commands

### Tauri app UI
```bash
cd app
pnpm install
pnpm run dev          # frontend only
pnpm run tauri dev    # real app shell + backend
pnpm run tauri build
pnpm run format
pnpm test
```

### Rust backend used by the Tauri app
```bash
cargo build -p app
cargo run -p cli              # run the CLI binary
cargo test --locked --workspace --all-features
cargo fmt --all
cargo clippy --locked --workspace --all-targets --all-features
```

### Useful targeted checks
```bash
cd app && pnpm test -- auth-session
cd app && pnpm test -- cloud-api
```

## Code Conventions & Common Patterns

### UI / UX patterns
- Reuse the existing panel split:
  - primary transfer action in `TransferTab`
  - detailed action UI in `SendPanel` / `ReceivePanel`
  - reusable status widgets in `app/src/lib/components/`
- Keep flows shallow. The current UX favors immediate action over wizard-style multistep screens.
- Preserve cross-platform affordances already in the UI:
  - desktop drag/drop + file picker
  - mobile QR scan
  - clipboard paste fallback
  - native share where available
- Keep receive actions explicit. Send is auto-generated; receive still uses a deliberate CTA button.
- When adding feedback, prefer existing primitives: toast + inline status card + modal, not new notification systems.

### SolidJS patterns
- Use `~/*` imports.
- Type signals explicitly when the type matters.
- Put shared transfer state in `GlobalStore`; do not duplicate per-panel state if it affects another panel.
- Route backend calls through `app/src/bindings.ts`; avoid raw `invoke()` scattered through components.
- Derived UI behavior often lives in the route shell (`index.tsx`) because it coordinates tabs, modals, persistence, and event subscriptions.

### Styling patterns
- The UI uses Solid + DaisyUI/Tailwind utility classes.
- Existing transfer surfaces favor rounded cards (`rounded-2xl` / `rounded-3xl`), soft borders, and compact action rows.
- Match the current visual language before inventing a new one.

### Rust/backend patterns that affect UX
- Tauri backend errors must cross the boundary as `String`.
- Progress comes from Tauri events; UI must tolerate partial/incremental updates.
- Use `tokio::sync::RwLock` for async shared state.
- Use `tokio::sync::mpsc::channel(32)` for progress streams.
- On Android, picked files may be `content://` URIs and must be copied into temp files before transfer.

## Important Files

| File | Why it matters |
| --- | --- |
| `app/src/routes/index.tsx` | Main UX shell: tabs, nav, persistence, nearby/cloud modals, event wiring |
| `app/src/components/TransferTab.tsx` | Main transfer workspace and share-channel switching |
| `app/src/components/SendPanel.tsx` | File/text share flow, auto ticket generation, QR/copy/share presentation |
| `app/src/components/ReceivePanel.tsx` | Ticket paste/scan flow, destination selection, progress display |
| `app/src/components/HistoryPanel.tsx` | Completed transfers, re-share affordance, open/delete actions |
| `app/src/lib/components/DropZone.tsx` | Desktop drag/drop + picker UX, mobile picker bridge |
| `app/src/lib/components/TransferProgress.tsx` | Shared progress card for receive/nearby transfers |
| `app/src/lib/components/IncomingRequestCard.tsx` | Accept/decline UI for nearby/cloud inbound transfers |
| `app/src/lib/components/FileManifest.tsx` | Compact file list used inside incoming transfer review |
| `app/src/lib/store.tsx` | Shared UI state for send/receive/nearby/cloud |
| `app/src/lib/auth.tsx` | Auth/session bridge for the Tauri UI |
| `app/src/lib/cloud-api.ts` | Cloud HTTP helpers; device ID and auth header handling |
| `app/src/bindings.ts` | Typed Tauri command wrappers used by the UI |
| `app/src-tauri/src/lib.rs` | Backend commands, event emission, nearby/cloud/mobile runtime |
| `translations.json` | Source of user-facing labels/subtitles used in transfer UI |

## Runtime/Tooling Preferences

- Use `pnpm` for all JS/TS work.
- Tauri UI runtime: SolidJS + Vite.
- Do not treat `app/` and `browser/` as interchangeable frontends; they are separate products.
- For UX validation, prefer `pnpm run tauri dev` over browser-only dev when the flow depends on plugins, file pickers, clipboard, QR scan, or Tauri events.
- Mobile-specific behavior exists in both UI and backend. When changing receive/share UX, check whether Android/iOS file-picker or deep-link constraints are involved.
- iOS release installs in this repo prefer `xcodegen` + `xcodebuild` + `devicectl`.

## Testing & QA

- Tauri frontend tests use Vitest in Node environment.
- Current automated tests cover helper logic more than visual behavior:
  - `app/tests/cloud-api.test.ts`
  - `app/tests/auth-session.test.ts`
- `app/tests/setup.ts` installs storage/crypto/window shims for unit tests.
- There is no meaningful component-level coverage for the send/receive UX today. For UI changes, manual validation in the Tauri shell is required.

### Minimum manual QA for share / receive changes
1. Desktop file selection via `DropZone`.
2. Auto ticket generation after file select.
3. Copy/share actions from the generated ticket card.
4. Ticket paste from clipboard in receive mode.
5. Destination folder selection persistence.
6. Progress updates, speed, ETA, and cancel action during receive.
7. Nearby incoming request modal accept/decline flow.
8. History re-share flow from `HistoryPanel`.
9. Mobile-only affordances if touched: QR scan, share sheet, picker behavior.
