# iOS Build and Install Guide

This document records the **current working** process for building the Tauri iOS app and installing it on a physical iPhone over USB.

## Recommended Flow

For this repository, the reliable iOS release path is:

1. Build with `xcodegen` + `xcodebuild`
2. Install the generated `.app` with `xcrun devicectl`
3. Optionally launch it with `xcrun devicectl`

Do **not** treat `pnpm run tauri ios build` as the primary release-install flow here. In this repo it is less reliable because the archive/export step can reintroduce unsupported entitlements for personal-team signing.

## Prerequisites

- Xcode 16+
- Apple Developer account or personal development team
- iPhone connected via USB, trusted by the Mac
- `pnpm` installed
- `xcodegen` available

## Important Repo-Specific Details

### 1. Use the generated Xcode project

Build from:

```bash
app/src-tauri/gen/apple/app.xcodeproj
```

The Xcode prebuild script already does the repo-specific work:

- runs `pnpm run build`
- syncs `app/dist/` into `app/src-tauri/gen/apple/assets/`
- builds the Rust static library for the correct iOS target
- enables `custom-protocol` for release builds so the app uses bundled assets instead of `http://localhost:1420/`

### 2. Keep iOS entitlements empty for personal-team signing

This file must stay empty for the current signing setup:

```bash
app/src-tauri/gen/apple/app_iOS/app_iOS.entitlements
```

Current expected content:

```xml
<dict>
</dict>
```

### 3. Current bundle identifier

The app installed on device is:

```text
io.sendme.app
```

## Build and Install

### 1. Install JS dependencies

```bash
cd app
pnpm install
```

### 2. Optional: enable Safari inspection on iOS

If you want the installed iPhone app to appear in macOS Safari's **Develop** menu, export this before building:

```bash
export SENDME_IOS_INSPECTOR=1
```

This keeps the normal release packaging flow, but adds an iOS-only Rust feature that marks the app's `WKWebView` as inspectable.

Leave it unset for a normal non-debuggable install.

### 3. Generate the Xcode project

Run this whenever `app/src-tauri/gen/apple/project.yml` changes, and it is harmless to run before a normal iOS build:

```bash
cd src-tauri/gen/apple
xcodegen generate
```

### 4. Build the iOS app

> **⚠️ Before running xcodebuild for the first time on a machine:**
> Open the project in Xcode GUI once (`open app/src-tauri/gen/apple/app.xcodeproj`),
> navigate to the **app_iOS** target → **Signing & Capabilities**, confirm the Team
> is set, and let Xcode create the provisioning profile. Without this step,
> `xcodebuild` will fail with **"No Accounts"** because the daemon cannot access
> Apple credentials that haven't been unlocked by the GUI.

**Run in the background** — the script phase re-runs `pnpm run build` (~6 min)
and `cargo build` (~2–4 min with cache). Killing the terminal mid-link will
leave you with a stale build. Use `nohup` so the build survives terminal close:

```bash
cd app/src-tauri/gen/apple

nohup xcodebuild \
  -project app.xcodeproj \
  -scheme app_iOS \
  -sdk iphoneos \
  -configuration release \
  -derivedDataPath build-ios \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=UJ8NW4N779 \
  build > /tmp/xcodebuild.log 2>&1 &

echo "Build running in background (PID $!)"
echo "Monitor: tail -f /tmp/xcodebuild.log"
echo "Or watch vite: watch -n5 'ps aux | grep vite | grep -v grep'"
```

Wait for completion:

```bash
# Poll until done
while ! grep -q 'BUILD SUCCEEDED\|BUILD FAILED' /tmp/xcodebuild.log 2>/dev/null; do
  sleep 10
  echo "$(date '+%H:%M:%S') still building..."
done
tail -5 /tmp/xcodebuild.log
```

Successful output ends with:

```text
** BUILD SUCCEEDED **
```

The built app will be at:

```bash
app/src-tauri/gen/apple/build-ios/Build/Products/release-iphoneos/Sendme.app
```

**Expected build times** (M-series Mac, warm cargo cache):

| Phase | Time |
|---|---|
| `pnpm run build` (Vite) | ~6 min |
| `cargo build` (cached) | ~2–4 min |
| Xcode link + sign | ~1–2 min |
| **Total** | **~10–12 min** |

First-time build (cold Rust cache) can take 20+ minutes.

### 6. Find the connected iPhone

```bash
xcrun devicectl list devices
```

Copy the device **Identifier** (UUID format, e.g. `03B551C1-4405-5372-891F-F72A02716CF7`)
and use it as `<device-id>` below.

> **Note:** `xcrun devicectl` uses the CoreDevice UUID (from `devicectl list devices`).
> `idevicesyslog` uses the legacy UDID (from `xcrun xctrace list devices`,
> the hex string in parentheses like `00008030-000A21391A83802E`). These are different.

### 7. Install to the iPhone

```bash
xcrun devicectl device install app \
  --device <device-id> \
  app/src-tauri/gen/apple/build-ios/Build/Products/release-iphoneos/Sendme.app
```

Expected success output includes:

```text
App installed:
• bundleID: io.sendme.app
```

### 8. Launch the app

First unlock the iPhone, then either tap the app manually or launch it from the Mac:

```bash
xcrun devicectl device process launch \
  --terminate-existing \
  --device <device-id> \
  io.sendme.app
```

> **Note:** `--console` streams the app's stdout/stderr but kills the app when
> the terminal session ends. For passive monitoring use `idevicesyslog` instead
> (see Troubleshooting below).

## Rebuild After Code Changes

```bash
cd app
pnpm install
export SENDME_IOS_INSPECTOR=1   # optional: enable Safari Web Inspector

cd src-tauri/gen/apple
xcodegen generate
xcodebuild -project app.xcodeproj \
  -scheme app_iOS \
  -sdk iphoneos \
  -configuration release \
  -derivedDataPath build-ios \
  build

xcrun devicectl device install app \
  --device <device-id> \
  "$PWD/build-ios/Build/Products/release-iphoneos/Sendme.app"
```

## Troubleshooting

### "No Accounts" error from xcodebuild

```text
error: No Accounts: Add a new account in Accounts settings. (in target 'app_iOS')
error: No profiles for 'io.sendme.app' were found
```

**Root cause:** `xcodebuild` runs via a background daemon that cannot access
Apple account credentials until Xcode GUI has been opened and signed in on
this machine.

**Fix:**
1. `open -a Xcode app/src-tauri/gen/apple/app.xcodeproj`
2. Select the **app_iOS** target → **Signing & Capabilities** tab
3. Ensure the Team is selected and Xcode shows a valid signing certificate
4. If a **Fix Issue** button appears, click it
5. Close Xcode, then re-run `xcodebuild`

This is a one-time setup per machine.

### Build takes a very long time (or seems stuck)

The Xcode build script (`project.yml` → **Build Rust Code** phase) always runs
uncached because "Based on dependency analysis" is unchecked. It:
1. Runs `pnpm run build` (Vite, ~6 min)
2. Runs `cargo build` (~2–4 min with cache, 15+ min cold)
3. Links and signs (~1–2 min)

**Don’t** kill the terminal — use `nohup` as shown above and monitor with:

```bash
# Is vite still compiling?
ps aux | grep vite | grep -v grep

# Is cargo still compiling?
ps aux | grep cargo | grep -v grep

# Overall progress
tail -5 /tmp/xcodebuild.log
```

### How to capture app logs from the iPhone

`devicectl device log stream` is not available. Use `idevicesyslog` instead
(install with `brew install libimobiledevice`):

```bash
# Get UDID from:
xcrun xctrace list devices   # hex string in parentheses

# Stream logs filtered to Sendme
idevicesyslog -u <UDID> | grep -i "sendme\|ERROR\|FATAL"

# Or save to file and inspect
idevicesyslog -u <UDID> > /tmp/ios.log &
# ... run the app ...
kill %1
grep -i sendme /tmp/ios.log | grep -iv wifid
```

### Healthy startup log indicators

When the app starts normally you will see in `idevicesyslog`:

```text
Sendme(<pid>)          → app process alive
com.apple.WebKit.WebContent  → WebView rendering the SolidJS UI
WebURLSchemeTaskProxy::startLoading  → Tauri serving bundled assets
WebURLSchemeTaskProxy::didComplete   → assets loaded OK
```

Network flows (TCP4 to relay servers, UDP6 for mDNS) are expected and
indicate iroh is running.

Sandbox denials for `/private/etc/resolv.conf` and
`process-info-codesignature` are expected and non-fatal.

### "No provider was found" warning

```text
Failed to load provisioning paramter list due to error:
Error Domain=com.apple.dt.CoreDeviceError Code=1002 "No provider was found."
```

This warning has been non-fatal in practice. Install/build can still succeed.

### App launch denied because the phone is locked

If `devicectl` launch fails with a locked-device error, unlock the iPhone and run the command again.

Typical failure looks like:

```text
Unable to launch io.sendme.app because the device was not, or could not be, unlocked
```

### App opens but shows `http://localhost:1420/`

That means the build did not go through the correct production flow. Use the Xcode flow in this document, not a stale or alternate iOS packaging path.

Release builds in this repo must come from the Xcode prebuild script in `app/src-tauri/gen/apple/project.yml`, which:

- rebuilds the frontend
- syncs `dist/` into the bundle
- compiles Rust with `--features custom-protocol`

### App installs but does not open

Check:

1. Developer trust on the iPhone:
   - **Settings** → **General** → **VPN与设备管理**
2. That `app_iOS.entitlements` is still empty
3. That the build ended with `BUILD SUCCEEDED`

### The app still does not appear in Safari Develop

Check:

1. The build was made with `SENDME_IOS_INSPECTOR=1`
2. The iPhone has **Settings** → **Safari** → **Advanced** → **Web Inspector** enabled
3. macOS Safari has **Develop** menu enabled
4. The device is connected, unlocked, and trusted

### Why not `pnpm run tauri ios build`?

In this repository, that path is currently less reliable for release installs because:

- archive/export can restore unsupported entitlements
- it is easier to end up with a build that does not match the repo's custom iOS prebuild logic

For now, prefer:

```bash
xcodegen generate
xcodebuild ...
xcrun devicectl device install app ...
```

## Quick Reference

| Action | Command |
| --- | --- |
| Generate project | `cd app/src-tauri/gen/apple && xcodegen generate` |
| Build iOS app (background) | `nohup xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios -allowProvisioningUpdates -allowProvisioningDeviceRegistration CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=UJ8NW4N779 build > /tmp/xcodebuild.log 2>&1 &` |
| Watch build log | `tail -f /tmp/xcodebuild.log` |
| List devices (CoreDevice UUID) | `xcrun devicectl list devices` |
| List devices (legacy UDID) | `xcrun xctrace list devices` |
| Install app | `xcrun devicectl device install app --device <UUID> app/src-tauri/gen/apple/build-ios/Build/Products/release-iphoneos/Sendme.app` |
| Launch app | `xcrun devicectl device process launch --terminate-existing --device <UUID> io.sendme.app` |
| Stream device logs | `idevicesyslog -u <UDID> \| grep -i sendme` |
