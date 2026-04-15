# iOS Photo/Video Picker — Design Spec

**Date:** 2026-04-15  
**Status:** Approved

## Overview

Replace the iOS file picker (currently `UIDocumentPickerViewController` via `tauri-plugin-dialog`) with a native photo/video picker (`PHPickerViewController`) that supports selecting photos and videos from the user's photo library, including multi-select.

## Requirements

- **Media types:** Photos and videos (original format — HEIC stays HEIC, HEVC stays HEVC).
- **Entry point:** Replaces the existing file picker on iOS entirely.
- **Multi-select:** User can select multiple photos/videos in one picker session.
- **Send flow:** Each selected file is sent as a separate transfer, each with its own ticket, appearing in the transfers list.

## Architecture

Three layers:

1. **Swift plugin class** (`MediaPickerPlugin.swift`) — presents `PHPickerViewController`, exports assets to temp dir, returns results to Rust.
2. **Rust plugin crate** (`tauri-plugin-media-picker`) — registers the Swift class, exposes a `pick_media` Tauri mobile command.
3. **Frontend + `pick_file` command** — iOS branch of `pick_file` in `lib.rs` delegates to the new plugin; frontend handles multi-file results.

## Data Flow

```
User taps "Select file" (iOS)
  → selectFile() [index.tsx] detects isMobile()
  → pick_file({ allow_multiple: true }) [Tauri command]
  → app.run_mobile_plugin("tauri-plugin-media-picker", "pickMedia", {})
  → MediaPickerPlugin.swift presents PHPickerViewController
      filter: .images + .videos
      selectionLimit: 0 (unlimited)
  → User selects photos/videos
  → Swift exports each via PHAssetResourceManager to NSTemporaryDirectory()
      original format, filename from PHAssetResource.originalFilename
  → Returns [{ uri, name, size, mimeType }] to Rust
  → Rust maps to Vec<PickerFileInfo>, returns to frontend
  → Frontend:
      single file → sets sendPath, user taps Send as usual
      multiple files → calls send_file() for each sequentially
                       each gets its own ticket + transfer entry
```

**Cancellation:** Empty array returned → frontend does nothing.  
**Per-file export errors:** Logged and skipped; partial results returned.

## Files

### New files

| Path | Purpose |
|------|---------|
| `app/src-tauri/plugins/tauri-plugin-media-picker/Cargo.toml` | Plugin crate manifest |
| `app/src-tauri/plugins/tauri-plugin-media-picker/src/lib.rs` | Rust side: registers iOS plugin class, exposes no-op stubs for non-iOS |
| `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Sources/MediaPickerPlugin.swift` | Swift: PHPickerViewController, asset export |

### Modified files

| Path | Change |
|------|--------|
| `app/src-tauri/Cargo.toml` | Add `tauri-plugin-media-picker` under `[target.'cfg(target_os = "ios")'.dependencies]` |
| `app/src-tauri/src/lib.rs` | Replace iOS stub `pick_file` to call `app.run_mobile_plugin(...)` |
| `app/src-tauri/Info.ios.plist` | Add `NSPhotoLibraryUsageDescription` key |
| `app/src/routes/index.tsx` | Update `selectFile()`: on iOS call `pick_file({ allow_multiple: true })`, handle array results |

## Key Implementation Notes

### Swift (`MediaPickerPlugin.swift`)

```swift
// PHPickerConfiguration
var config = PHPickerConfiguration(photoLibrary: .shared())
config.filter = PHPickerFilter.any(of: [.images, .videos])
config.selectionLimit = 0  // 0 = unlimited

// Export — original format
PHAssetResourceManager.default().requestData(
    for: resource,
    options: nil,
    dataReceivedHandler: { data in ... },
    completionHandler: { error in ... }
)
// Write to NSTemporaryDirectory() / UUID / originalFilename
```

- Must be presented on the main thread.
- Tauri iOS plugins receive a `WKWebView`-hosting `UIViewController`; use `webView.window?.rootViewController` to get the presenter.
- Plugin method name for `run_mobile_plugin`: `"pickMedia"` (camelCase as Tauri iOS convention).

### Rust (`lib.rs` — iOS `pick_file`)

```rust
#[cfg(target_os = "ios")]
async fn pick_file(
    app: AppHandle,
    _allowed_types: Option<Vec<String>>,
    _allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    use serde_json::Value;
    let result: Vec<Value> = app
        .run_mobile_plugin("tauri-plugin-media-picker", "pickMedia", ())
        .map_err(|e| format!("Media picker failed: {e}"))?;
    // map to Vec<PickerFileInfo>
    ...
}
```

### Frontend (`index.tsx`)

```typescript
async function selectFile() {
  if (isMobile()) {
    const files = await pick_file({ allow_multiple: true });
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      globalStore.send.setPath(files[0].uri);
      globalStore.send.setTicket("");
      globalStore.send.setIsTextMode(false);
    } else {
      // multi-select: send each file immediately, no single "current ticket"
      // shown in main UI — all results appear in the transfers list only
      for (const file of files) {
        await send_file({ path: file.uri, ticket_type: sendTicketType() });
      }
      await loadTransfers();
      // sendPath stays empty; user accesses each ticket from transfers list
    }
  } else {
    const selected = await open({ multiple: false, directory: false });
    if (selected && typeof selected === "string") {
      globalStore.send.setPath(selected);
      globalStore.send.setTicket("");
      globalStore.send.setIsTextMode(false);
    }
  }
}
```

### Permissions (`Info.ios.plist`)

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Sendme needs access to your photo library to send photos and videos.</string>
```

`PHPickerViewController` (iOS 14+) uses a privacy-preserving picker that does not require `PHAuthorizationStatus` for the assets the user explicitly selects. The plist key is still required by App Store review.

## Testing

1. Build with `xcodegen generate` + `xcodebuild` (see `docs/ios-build-install.md`).
2. Tap "Select file" → photo library opens.
3. Select one photo → `sendPath` is set, tap Send → ticket generated.
4. Select multiple photos → each appears as a separate transfer in the list.
5. Cancel picker → no change in UI state.
6. Select a video → sends correctly in original format.
7. Select HEIC photo → sends as HEIC (no conversion).
