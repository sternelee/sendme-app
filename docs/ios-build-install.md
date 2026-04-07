# iOS Build and Install Guide

This document records the process for building the Tauri iOS app and installing it on a physical iPhone via USB.

## Prerequisites

- Xcode 16+
- Apple Developer account with valid provisioning profile
- iPhone connected via USB with trust established

## Build Process (Recommended)

Due to a known issue with Xcode 16 sandbox permissions, use the following workflow:

### 1. Build with Cargo (bypasses Xcode script sandbox)

```bash
cd app
pnpm install
pnpm tauri build --target aarch64-apple-ios
```

This creates a release build at:
```
app/src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Sendme.app
```

### 2. Find Connected iPhone

```bash
xcrun devicectl list devices
```

Output shows device info:
```
Name               Hostname                             Identifier                             State
----------------   ----------------------------------   ------------------------------------   ---------
Sterne的iPhone se   SternedeiPhone-se.coredevice.local   03B551C1-4405-5372-891F-F72A02716CF7   connected
```

Copy the **Identifier** (UUID) for the next step.

### 3. Uninstall Old Version (Optional)

```bash
xcrun devicectl device uninstall app \
  --device 03B551C1-4405-5372-891F-F72A02716CF7 \
  sendme.leechat.app
```

### 4. Install App to iPhone

```bash
xcrun devicectl device install app \
  --device 03B551C1-4405-5372-891F-F72A02716CF7 \
  app/src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Sendme.app
```

Output on success:
```
App installed:
• bundleID: sendme.leechat.app
• installationURL: file:///private/var/containers/Bundle/Application/.../Sendme.app/
```

### 5. Launch the App

1. **Manual**: Unlock iPhone and tap the Sendme app icon
2. **Or use Xcode**: Open `app/src-tauri/gen/apple/app.xcodeproj` in Xcode and run

## Troubleshooting

### Xcode Script Sandbox Error

When running `pnpm tauri ios build` or `pnpm tauri ios run`, you may encounter:

```
failed to determine package fingerprint for build script
Caused by: Operation not permitted (os error 1)
```

This is a **known issue** with Xcode 16 + Tauri 2.x where the Xcode sandbox prevents cargo from reading project files.

**Solution**: Use `pnpm tauri build --target aarch64-apple-ios` instead, which bypasses the Xcode script phase.

### "No provider was found" Warning

```
Failed to load provisioning paramter list due to error: Error Domain=com.apple.dt.CoreDeviceError Code=1002 "No provider was found."
```

This is a **non-fatal warning** from Xcode 16. The install still succeeds.

### Trust Issue on iPhone

If the app won't open after installation:

1. Go to **Settings** → **General** → **VPN与设备管理** (VPN & Device Management)
2. Find your developer app entry (may show as email address)
3. Tap it and select **信任** (Trust)

### Rebuild After Code Changes

```bash
# 1. Rebuild
cd app
pnpm tauri build --target aarch64-apple-ios

# 2. Uninstall old version
xcrun devicectl device uninstall app --device 03B551C1-4405-5372-891F-F72A02716CF7 sendme.leechat.app

# 3. Install new version
xcrun devicectl device install app --device 03B551C1-4405-5372-891F-F72A02716CF7 app/src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Sendme.app
```

## Quick Reference

| Action              | Command                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Build iOS           | `cd app && pnpm tauri build --target aarch64-apple-ios`                                          |
| List devices        | `xcrun devicectl list devices`                                                                    |
| Uninstall app       | `xcrun devicectl device uninstall app --device <UUID> sendme.leechat.app`                         |
| Install app         | `xcrun devicectl device install app --device <UUID> app/src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Sendme.app` |

## Alternative: Using Xcode Directly

1. Open the Xcode project:
   ```bash
   open app/src-tauri/gen/apple/app.xcodeproj
   ```

2. Select your device from the device dropdown

3. Click the **Run** button (or press Cmd+R)

This method may also encounter the sandbox issue depending on your Xcode configuration.
