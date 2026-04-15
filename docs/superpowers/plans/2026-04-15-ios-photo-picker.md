# iOS Photo/Video Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iOS file picker with a `PHPickerViewController`-based Tauri plugin that lets users select photos and videos (multi-select, original format) from the system photo library.

**Architecture:** A new Rust crate `tauri-plugin-media-picker` (in `app/src-tauri/plugins/`) provides a Swift `MediaPickerPlugin` class that presents `PHPickerViewController` and exports selected assets to the app temp directory. The existing `pick_file` iOS command is wired to call this plugin. The frontend's `selectFile()` handles the returned array (single file → set path; multiple files → send each immediately).

**Tech Stack:** Rust (Tauri 2 plugin API), Swift 5.9+ / Swift 6, `PHPickerViewController` (iOS 14+, deployment target is 15.1), `PhotosUI`, `Photos`, SolidJS frontend.

---

## File Map

### New files
| Path | Responsibility |
|------|----------------|
| `app/src-tauri/plugins/tauri-plugin-media-picker/Cargo.toml` | Plugin crate manifest |
| `app/src-tauri/plugins/tauri-plugin-media-picker/build.rs` | Copies tauri-api Swift package, links iOS static lib |
| `app/src-tauri/plugins/tauri-plugin-media-picker/src/lib.rs` | Rust plugin: registers iOS Swift class, exposes `MediaPickerExt` trait |
| `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Package.swift` | Swift package manifest for the plugin |
| `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Sources/MediaPickerPlugin.swift` | Swift: presents PHPickerViewController, exports assets, returns results |

### Modified files
| Path | Change |
|------|--------|
| `app/src-tauri/Cargo.toml` | Add `tauri-plugin-media-picker` under `[target.'cfg(target_os = "ios")'.dependencies]` |
| `app/src-tauri/src/lib.rs` | Register plugin in builder; replace iOS `pick_file` stub |
| `app/src-tauri/Info.ios.plist` | Add `NSPhotoLibraryUsageDescription` |
| `app/src/routes/index.tsx` | Update `selectFile()` to handle multi-file results on iOS |

---

## Task 1: Create the plugin crate scaffold

**Files:**
- Create: `app/src-tauri/plugins/tauri-plugin-media-picker/Cargo.toml`
- Create: `app/src-tauri/plugins/tauri-plugin-media-picker/build.rs`
- Create: `app/src-tauri/plugins/tauri-plugin-media-picker/src/lib.rs`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p app/src-tauri/plugins/tauri-plugin-media-picker/src
mkdir -p app/src-tauri/plugins/tauri-plugin-media-picker/ios/Sources
```

- [ ] **Step 2: Write Cargo.toml**

Create `app/src-tauri/plugins/tauri-plugin-media-picker/Cargo.toml`:

```toml
[package]
name = "tauri-plugin-media-picker"
version = "0.1.0"
edition = "2021"
links = "tauri-plugin-media-picker"

[lib]
name = "tauri_plugin_media_picker"

[dependencies]
tauri = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
tauri-plugin = { version = "2.1.1", features = ["build"] }
```

- [ ] **Step 3: Write build.rs**

Create `app/src-tauri/plugins/tauri-plugin-media-picker/build.rs`:

```rust
const COMMANDS: &[&str] = &["pickMedia"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
```

- [ ] **Step 4: Write src/lib.rs**

Create `app/src-tauri/plugins/tauri-plugin-media-picker/src/lib.rs`:

```rust
#![cfg(target_os = "ios")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_media_picker);

/// A single media file returned by the picker.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub uri: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

/// Handle to the iOS media picker plugin.
pub struct MediaPicker<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MediaPicker<R> {
    /// Present the system photo picker and return selected files.
    /// Returns an empty Vec if the user cancels.
    pub async fn pick_media(
        &self,
    ) -> Result<Vec<MediaFile>, tauri::plugin::mobile::PluginInvokeError> {
        self.0
            .run_mobile_plugin_async("pickMedia", serde_json::Value::Null)
            .await
    }
}

/// Extension trait for AppHandle / Manager to access the picker.
pub trait MediaPickerExt<R: Runtime> {
    fn media_picker(&self) -> &MediaPicker<R>;
}

impl<R: Runtime, T: Manager<R>> MediaPickerExt<R> for T {
    fn media_picker(&self) -> &MediaPicker<R> {
        self.state::<MediaPicker<R>>().inner()
    }
}

/// Initialise the plugin — call this in your Tauri builder.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("media-picker")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_media_picker)?;
            app.manage(MediaPicker(handle));
            Ok(())
        })
        .build()
}
```

- [ ] **Step 5: Verify the crate compiles (iOS target)**

```bash
cd app/src-tauri
cargo check -p tauri-plugin-media-picker --target aarch64-apple-ios 2>&1 | head -30
```

Expected: no errors. Warnings about unused imports are fine at this stage.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/plugins/tauri-plugin-media-picker/
git commit -m "feat(ios): scaffold tauri-plugin-media-picker crate"
```

---

## Task 2: Create the Swift plugin

**Files:**
- Create: `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Package.swift`
- Create: `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Sources/MediaPickerPlugin.swift`

- [ ] **Step 1: Write Package.swift**

Create `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Package.swift`:

```swift
// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-media-picker",
  platforms: [
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-media-picker",
      type: .static,
      targets: ["tauri-plugin-media-picker"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-media-picker",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
```

- [ ] **Step 2: Write MediaPickerPlugin.swift**

Create `app/src-tauri/plugins/tauri-plugin-media-picker/ios/Sources/MediaPickerPlugin.swift`:

```swift
import PhotosUI
import Tauri
import UIKit
import WebKit

class MediaPickerPlugin: Plugin {
    // nonisolated(unsafe) is safe here: currentInvoke is set on the
    // Tauri invoke thread and read only inside the @MainActor delegate
    // callback, with no concurrent mutation possible.
    nonisolated(unsafe) var currentInvoke: Invoke?
    var webView: WKWebView?

    @objc override public func load(webview: WKWebView) {
        super.load(webview: webview)
        self.webView = webview
    }

    @objc public func pickMedia(_ invoke: Invoke) {
        currentInvoke = invoke

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = PHPickerFilter.any(of: [.images, .videos])
            config.selectionLimit = 0 // 0 = unlimited

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self

            guard let presenter = self.webView?.window?.rootViewController else {
                self.currentInvoke?.reject("Unable to find presenter view controller")
                self.currentInvoke = nil
                return
            }

            presenter.present(picker, animated: true)
        }
    }
}

extension MediaPickerPlugin: PHPickerViewControllerDelegate {
    public func picker(
        _ picker: PHPickerViewController,
        didFinishPicking results: [PHPickerResult]
    ) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            currentInvoke?.resolve([JSObject]())
            currentInvoke = nil
            return
        }

        let invoke = currentInvoke
        currentInvoke = nil

        var mediaFiles: [JSObject] = []
        let lock = NSLock()
        let group = DispatchGroup()

        for result in results {
            let itemProvider = result.itemProvider
            guard let typeIdentifier = itemProvider.registeredTypeIdentifiers.first else {
                continue
            }

            group.enter()
            itemProvider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                defer { group.leave() }

                guard let url = url, error == nil else { return }

                // The url is only valid during this callback — copy it to tmp
                let tmpDir = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                let destURL = tmpDir.appendingPathComponent(url.lastPathComponent)

                do {
                    try FileManager.default.createDirectory(
                        at: tmpDir, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: destURL)

                    let attrs = try FileManager.default.attributesOfItem(atPath: destURL.path)
                    let size = attrs[.size] as? Int ?? 0

                    var obj = JSObject()
                    obj["uri"] = destURL.absoluteString
                    obj["name"] = url.lastPathComponent
                    obj["size"] = size
                    obj["mimeType"] = mimeType(for: typeIdentifier)

                    lock.lock()
                    mediaFiles.append(obj)
                    lock.unlock()
                } catch {
                    // Skip files that fail to copy; log to console
                    print("[MediaPickerPlugin] Failed to copy \(url.lastPathComponent): \(error)")
                }
            }
        }

        group.notify(queue: .main) {
            invoke?.resolve(mediaFiles)
        }
    }

    private func mimeType(for typeIdentifier: String) -> String {
        switch typeIdentifier {
        case "public.jpeg":                  return "image/jpeg"
        case "public.png":                   return "image/png"
        case "public.heic", "public.heif":   return "image/heic"
        case "public.tiff":                  return "image/tiff"
        case "public.gif":                   return "image/gif"
        case "com.apple.quicktime-movie":    return "video/quicktime"
        case "public.mpeg-4":               return "video/mp4"
        case "public.movie":               return "video/quicktime"
        default:
            if typeIdentifier.hasPrefix("public.") && typeIdentifier.contains("video") {
                return "video/quicktime"
            }
            if typeIdentifier.hasPrefix("public.") && typeIdentifier.contains("image") {
                return "image/jpeg"
            }
            return "application/octet-stream"
        }
    }
}

@_cdecl("init_plugin_media_picker")
func initPlugin() -> Plugin {
    return MediaPickerPlugin()
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/plugins/tauri-plugin-media-picker/ios/
git commit -m "feat(ios): add MediaPickerPlugin Swift class with PHPickerViewController"
```

---

## Task 3: Wire the plugin into the app

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependency in app Cargo.toml**

In `app/src-tauri/Cargo.toml`, add to the `[target.'cfg(target_os = "ios")'.dependencies]` section:

```toml
[target.'cfg(target_os = "ios")'.dependencies]
tauri-plugin-fs-ios = "0.4"
objc2 = "0.6"
tauri-plugin-media-picker = { path = "./plugins/tauri-plugin-media-picker" }
```

- [ ] **Step 2: Register the plugin in the Tauri builder**

In `app/src-tauri/src/lib.rs`, find the iOS plugin registration block (around line 1837):

```rust
    #[cfg(target_os = "ios")]
    {
        builder = builder.plugin(tauri_plugin_fs_ios::init());
    }
```

Change to:

```rust
    #[cfg(target_os = "ios")]
    {
        builder = builder
            .plugin(tauri_plugin_fs_ios::init())
            .plugin(tauri_plugin_media_picker::init());
    }
```

- [ ] **Step 3: Replace the iOS pick_file stub**

In `app/src-tauri/src/lib.rs`, find the iOS `pick_file` function (around line 3389). Replace it entirely:

```rust
#[tauri::command]
#[cfg(target_os = "ios")]
async fn pick_file(
    app: AppHandle,
    _allowed_types: Option<Vec<String>>,
    _allow_multiple: Option<bool>,
) -> Result<Vec<PickerFileInfo>, String> {
    use tauri_plugin_media_picker::MediaPickerExt;

    log_info!("═══════════════════════════════════════════════════");
    log_info!("📸 PICK_FILE (iOS) — presenting photo library picker");
    log_info!("═══════════════════════════════════════════════════");

    let media_files = app
        .media_picker()
        .pick_media()
        .await
        .map_err(|e| format!("Media picker failed: {e}"))?;

    log_info!("✅ Picker returned {} file(s)", media_files.len());

    Ok(media_files
        .into_iter()
        .map(|f| PickerFileInfo {
            uri: f.uri,
            path: String::new(), // resolved by handle_content_uri in send_file
            name: f.name,
            size: f.size,
            mime_type: f.mime_type,
        })
        .collect())
}
```

- [ ] **Step 4: Verify Rust compilation for iOS**

```bash
cd app/src-tauri
cargo check -p app --target aarch64-apple-ios 2>&1 | head -40
```

Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/src/lib.rs
git commit -m "feat(ios): wire tauri-plugin-media-picker into app, replace pick_file stub"
```

---

## Task 4: Add photo library permission to Info.plist

**Files:**
- Modify: `app/src-tauri/Info.ios.plist`

- [ ] **Step 1: Add NSPhotoLibraryUsageDescription**

In `app/src-tauri/Info.ios.plist`, add after the `<dict>` opening tag (before `NSCameraUsageDescription`):

```xml
    <key>NSPhotoLibraryUsageDescription</key>
    <string>Sendme needs access to your photo library to send photos and videos.</string>
```

The resulting start of the `<dict>` block should look like:

```xml
  <dict>
    <key>NSPhotoLibraryUsageDescription</key>
    <string>Sendme needs access to your photo library to send photos and videos.</string>

    <key>NSCameraUsageDescription</key>
    <string>Read QR codes</string>
    ...
```

- [ ] **Step 2: Commit**

```bash
git add app/src-tauri/Info.ios.plist
git commit -m "feat(ios): add NSPhotoLibraryUsageDescription"
```

---

## Task 5: Update frontend to handle multi-select

**Files:**
- Modify: `app/src/routes/index.tsx`

- [ ] **Step 1: Update selectFile() for iOS**

In `app/src/routes/index.tsx`, find `selectFile()` (around line 200):

```typescript
  async function selectFile() {
    try {
      const selected = await open({ multiple: false, directory: false });
      if (selected && typeof selected === "string") {
        globalStore.send.setPath(selected);
        globalStore.send.setTicket("");
        globalStore.send.setIsTextMode(false);
      }
    } catch (e) {}
  }
```

Replace with:

```typescript
  async function selectFile() {
    try {
      if (isMobile()) {
        // iOS: use native photo/file picker via pick_file command
        const files = await pick_file({ allow_multiple: true });
        if (!files || files.length === 0) return;

        if (files.length === 1) {
          // Single selection: set path and let user tap Send as normal
          globalStore.send.setPath(files[0].uri);
          globalStore.send.setTicket("");
          globalStore.send.setIsTextMode(false);
        } else {
          // Multi-selection: send each file immediately; tickets appear in transfers list
          globalStore.send.setIsSending(true);
          try {
            for (const file of files) {
              await send_file({
                path: file.uri,
                ticket_type: sendTicketType(),
              });
            }
            await loadTransfers();
          } finally {
            globalStore.send.setIsSending(false);
          }
        }
      } else {
        // Desktop: use tauri-plugin-dialog document picker
        const selected = await open({ multiple: false, directory: false });
        if (selected && typeof selected === "string") {
          globalStore.send.setPath(selected);
          globalStore.send.setTicket("");
          globalStore.send.setIsTextMode(false);
        }
      }
    } catch (e) {
      console.error("selectFile error:", e);
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd app
pnpm run build 2>&1 | tail -20
```

Expected: build succeeds without type errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/index.tsx
git commit -m "feat(ios): update selectFile() to handle photo picker multi-select"
```

---

## Task 6: Build and install on device

- [ ] **Step 1: Set environment and regenerate Xcode project**

```bash
cd app/src-tauri/gen/apple
export CLERK_PUBLISHABLE_KEY='pk_test_cHJpbWFyeS1ib2EtMjIuY2xlcmsuYWNjb3VudHMuZGV2JA'
export SENDME_IOS_INSPECTOR=1
xcodegen generate
```

Expected: `Generating project...` with no errors.

- [ ] **Step 2: Build the iOS app**

```bash
cd app/src-tauri/gen/apple
xcodebuild \
  -project app.xcodeproj \
  -scheme app_iOS \
  -sdk iphoneos \
  -configuration release \
  -derivedDataPath build-ios \
  build \
  SENDME_IOS_INSPECTOR=1 \
  CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" \
  2>&1 | tail -40
```

Expected: `** BUILD SUCCEEDED **`

If Swift concurrency errors appear for `MediaPickerPlugin.swift`, see the "Troubleshooting" section below.

- [ ] **Step 3: Install on device**

```bash
xcrun devicectl device install app \
  --device 03B551C1-4405-5372-891F-F72A02716CF7 \
  "$(pwd)/build-ios/Build/Products/release-iphoneos/Sendme.app"
```

Expected: `Successfully installed ...`

- [ ] **Step 4: Manual smoke test on device**

1. Open the app. Tap "Send". Verify photo library opens (not document picker).
2. Cancel the picker. Verify no change in UI state.
3. Select one photo. Verify the file name appears in the send field.
4. Tap "Generate ticket". Verify ticket is created.
5. Select multiple photos (2+). Verify all appear as separate transfers in the list.
6. Select a video. Verify it sends correctly.
7. Select a HEIC photo. Verify file extension is `.heic` in the transfer (no conversion).

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat(ios): complete photo/video picker — PHPickerViewController via Tauri plugin"
```

---

## Troubleshooting

### Swift 6 concurrency errors on `nonisolated(unsafe)`

If the Swift compiler rejects `nonisolated(unsafe)` (requires Swift 5.10+, available in Xcode 15.3+), replace it with `@preconcurrency` on the protocol conformance:

```swift
class MediaPickerPlugin: Plugin {
    var currentInvoke: Invoke?
    ...
}

extension MediaPickerPlugin: @preconcurrency PHPickerViewControllerDelegate {
    public func picker(...) { ... }
}
```

### `DEP_TAURI_IOS_LIBRARY_PATH` not found during cargo check

This variable is only set during Xcode builds (by tauri's build.rs linking mechanism). Running `cargo check --target aarch64-apple-ios` outside of Xcode may skip the build.rs iOS branch. This is expected — the full verification is the Xcode build in Task 6.

### Photo picker doesn't appear / app crashes on present

Check that `webView?.window?.rootViewController` is non-nil. If it returns nil at the time of the call, the webview may not yet be in the window hierarchy. As a fallback, walk up the view hierarchy: `webView?.window?.rootViewController?.presentedViewController ?? webView?.window?.rootViewController`.

### `loadFileRepresentation` returns wrong format

For Live Photos, `registeredTypeIdentifiers` may include `com.apple.live-photo`. Skip this UTI and use `public.jpeg` or `com.apple.quicktime-movie` from the remaining identifiers. To explicitly request original format for an asset, use `PHAssetResourceManager` with `PHAssetResourceType.photo`/`.video` instead of `loadFileRepresentation`. This is an optional enhancement if original format fidelity is critical.
