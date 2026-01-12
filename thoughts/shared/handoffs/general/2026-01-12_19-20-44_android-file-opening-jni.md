---
date: 2026-01-12T19:20:44+08:00
session_name: general
researcher: claude
git_commit: 12fdd27a982009c340f1b94eb390c2c5cbac1f78
branch: main
repository: iroh-sendme
topic: "Android File Opening via JNI Implementation"
tags: [android, jni, file-provider, mediastore, scoped-storage]
status: blocked
last_updated: 2026-01-12
last_updated_by: claude
type: implementation_strategy
root_span_id:
turn_span_id:
---

# Handoff: Android File Opening - Click to Open Received Files

## Task(s)

### Completed
- Files are now saved to public Downloads directory on Android instead of private app storage
- Added `export_dir` parameter to `ReceiveArgs` in library
- Created `get_default_download_folder()` command to get public Downloads path
- Created `open_received_file` command with platform-specific implementations
- Created `list_received_files` command to list received files
- Added click handlers in Vue frontend to make file names clickable

### Blocked
- **Clicking file names causes app crash** - The `MainActivity.openFile()` method in Kotlin is not being called from Rust JNI
- No logcat output suggests JNI call is failing silently

## Critical References

- `app/src-tauri/src/android.rs:10-46` - JNI call to MainActivity.openFile
- `app/src-tauri/gen/android/app/src/main/java/com/sendme/app/MainActivity.kt:30-77` - Kotlin openFile implementation
- `lib/src/types.rs:168-176` - ReceiveArgs with export_dir parameter
- `lib/src/receive.rs:252-255` - Using export_dir for file export

## Recent changes

### Library Changes
- `lib/src/types.rs:168-176` - Added `export_dir: Option<PathBuf>` to `ReceiveArgs`
- `lib/src/receive.rs:252-255` - Use `export_dir` for final file location
- `cli/src/main.rs:138` - CLI sets `export_dir: None`

### Tauri App Changes
- `app/src-tauri/src/android.rs` - Complete rewrite, simplified to call MainActivity.openFile via JNI
- `app/src-tauri/src/lib.rs:684-701` - On Android, use Downloads directory as export_dir
- `app/src-tauri/src/lib.rs:1624-1646` - open_received_file uses Downloads directory
- `app/src-tauri/src/lib.rs:1726-1733` - list_received_files uses Downloads directory
- `app/src-tauri/gen/android/app/src/main/java/com/sendme/app/MainActivity.kt` - Added openFile() method with MediaStore API

### Frontend Changes
- `app/src/App.vue` - Added click handlers to file names, calls `open_received_file`
- `app/src/lib/commands.ts` - Added `open_received_file` and `list_received_files` wrappers

## Learnings

### What Worked
- **File storage location**: Successfully changed from private app storage to public Downloads directory
  - Files are now accessible via file manager
  - Path: `/storage/emulated/0/Download/`

### What Failed
1. **Pure JNI approach with FileProvider** - Failed because FileProvider cannot access external storage (scoped storage restriction)
2. **JNI with Uri.fromFile()** - Failed because Android 10+ throws `FileUriExposedException` for file:// URIs
3. **JNI calling Kotlin MainActivity.openFile()** - No logcat output suggests the JNI call itself is failing silently
   - Possible causes:
     - Method signature mismatch
     - Activity context not properly accessible
     - JNI class loading issue

### Key Decisions
- **Decision**: Use public Downloads directory for received files
  - Reason: Private app storage is inaccessible to file managers and other apps
  - Alternative considered: Using app-specific external directories (rejected - still not easily accessible)

- **Decision**: Call Kotlin method from Rust JNI rather than pure JNI implementation
  - Reason: Kotlin/Java has better MediaStore API support
  - Status: Not working - JNI call appears to fail silently

## Post-Mortem

### What Worked
- `export_dir` parameter pattern allows separating blob storage from final file location
- Kotlin `MainActivity.openFile()` implementation with MediaStore query is the correct approach for Android 10+

### What Failed
- JNI call pattern `env.call_method(&activity, "openFile", "(Ljava/lang/String;)Z", ...)` may not be finding the method
- Need to investigate:
  - Whether MainActivity context is correctly obtained via `ndk_context::android_context()`
  - Whether method is being called on correct object (Activity vs Context)
  - Whether proguard/R8 is removing the method

### Key Decisions
- For next iteration: Consider using Tauri plugin pattern instead of direct JNI
- Alternative: Use `tauri-plugin-opener` with a custom Android implementation in the plugin

## Artifacts

### Modified Files
- `lib/src/types.rs` - Added export_dir to ReceiveArgs
- `lib/src/receive.rs` - Use export_dir for file export
- `cli/src/main.rs` - CLI export_dir handling
- `app/src-tauri/src/lib.rs` - Android file location changes
- `app/src-tauri/src/android.rs` - JNI call to MainActivity
- `app/src-tauri/gen/android/app/src/main/java/com/sendme/app/MainActivity.kt` - openFile() implementation
- `app/src/App.vue` - Click handlers
- `app/src/lib/commands.ts` - Command wrappers

### Build Artifacts
- APK: `/Users/sternelee/www/github/iroh-sendme/app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

## Action Items & Next Steps

### Debug JNI Call Issue
1. Verify MainActivity method is being called:
   - Add logging in Rust JNI code before/after call
   - Add try-catch in Kotlin to catch any exceptions
   - Check if method needs `@JvmStatic` or different visibility

2. Alternative approaches to consider:
   - Use Tauri command pattern with plugin
   - Create a custom Tauri plugin for file opening
   - Use `tauri-plugin-opener` with Android-specific implementation

### Testing Steps Once Fixed
1. Install APK and click received file name
2. Check logcat for `SendmeMainActivity` tags
3. Verify file opens in appropriate app
4. Test various file types (images, PDFs, APKs, etc.)

## Other Notes

### File Paths Summary
- **Blob storage (temp)**: `/data/user/0/com.sendme.app/cache/.sendme-recv-*`
- **Final files**: `/storage/emulated/0/Download/`
- **FileProvider config**: `app/src-tauri/gen/android/app/src/main/res/xml/file_paths.xml`

### Android Manifest Permissions
Current permissions in `AndroidManifest.xml`:
- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_WIFI_STATE`

May need to add:
- `READ_EXTERNAL_STORAGE` (for Android < 10)
- `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` (for Android 13+)

### JNI Debugging Commands
```bash
# Check if method exists in APK
aapt dump xmltree app-universal-release.apk AndroidManifest.xml

# View logcat
adb logcat | grep -E "(SendmeMainActivity|sendme|AndroidRuntime)"
```
