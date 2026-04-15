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
- A valid Clerk publishable key exported before mobile builds

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

### 2. Export the Clerk key

```bash
export CLERK_PUBLISHABLE_KEY='pk_test_...'
```

### 3. Generate the Xcode project

Run this whenever `app/src-tauri/gen/apple/project.yml` changes, and it is harmless to run before a normal iOS build:

```bash
cd src-tauri/gen/apple
xcodegen generate
```

### 4. Build the iOS app

```bash
xcodebuild -project app.xcodeproj \
  -scheme app_iOS \
  -sdk iphoneos \
  -configuration release \
  -derivedDataPath build-ios \
  build
```

Successful output ends with:

```text
** BUILD SUCCEEDED **
```

The built app will be at:

```bash
app/src-tauri/gen/apple/build-ios/Build/Products/release-iphoneos/Sendme.app
```

### 5. Find the connected iPhone

```bash
xcrun devicectl list devices
```

Copy the device **Identifier** and use it as `<device-id>` below.

### 6. Install to the iPhone

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

### 7. Launch the app

First unlock the iPhone, then either tap the app manually or launch it from the Mac:

```bash
xcrun devicectl device process launch \
  --console \
  --terminate-existing \
  --device <device-id> \
  io.sendme.app
```

## Rebuild After Code Changes

```bash
cd app
pnpm install
export CLERK_PUBLISHABLE_KEY='pk_test_...'

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
| Build iOS app | `xcodebuild -project app.xcodeproj -scheme app_iOS -sdk iphoneos -configuration release -derivedDataPath build-ios build` |
| List devices | `xcrun devicectl list devices` |
| Install app | `xcrun devicectl device install app --device <device-id> app/src-tauri/gen/apple/build-ios/Build/Products/release-iphoneos/Sendme.app` |
| Launch app | `xcrun devicectl device process launch --console --terminate-existing --device <device-id> io.sendme.app` |

