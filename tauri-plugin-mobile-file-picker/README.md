# Tauri Plugin mobile-file-picker

Native file and directory picker for Tauri mobile apps (Android & iOS).

## Features

- **Native file picking** - Uses platform-native file pickers (SAF on Android, UIDocumentPicker on iOS)
- **Directory picking** - Select folders with full tree access
- **Content URI support** - Read and write content:// URIs on Android
- **Long-term access** - Persist permissions across app restarts (Android persistable URI, iOS bookmarks)
- **Virtual file support** - Handle Google Docs and other virtual files on Android
- **Local copying** - Copy remote files to local storage for native operations

## Installation

Add the plugin to your Tauri project:

```bash
# Add the plugin to your Cargo.toml
cargo add tauri-plugin-mobile-file-picker
```

Then register it in your Tauri app:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_mobile_file_picker::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Usage

### TypeScript/JavaScript API

```typescript
import {
  pickFile,
  pickDirectory,
  readContent,
  copyToLocal,
  writeContent,
  releaseAccess,
  decodeBase64,
  encodeBase64,
} from 'tauri-plugin-mobile-file-picker-api';
```

### Pick a File

```typescript
// Pick a single image file
const files = await pickFile({
  allowedTypes: ['image/*'],
});
console.log('Selected:', files[0].name, files[0].mimeType);

// Pick multiple files with long-term access
const files = await pickFile({
  allowMultiple: true,
  mode: 'open',
  requestLongTermAccess: true,
});

// Handle virtual files (Google Docs, etc.)
const files = await pickFile({
  allowVirtualFiles: true,
});

for (const file of files) {
  if (file.isVirtual) {
    console.log('Virtual file, can convert to:', file.convertibleToMimeTypes);
  }
}
```

### Pick a Directory

```typescript
const dir = await pickDirectory({
  requestLongTermAccess: true,
});
console.log('Selected directory:', dir.name);
console.log('URI:', dir.uri);
```

### Read Content from a URI

This is essential for Android where content:// URIs cannot be read directly with standard file APIs.

```typescript
// Read file content
const result = await readContent({ uri: file.uri });
const bytes = decodeBase64(result.data);
console.log('Read', result.size, 'bytes');

// Convert virtual file (e.g., Google Doc to PDF)
const pdfResult = await readContent({
  uri: file.uri,
  convertVirtualAsType: 'application/pdf',
});
```

### Copy to Local Storage

When you need a local file path (e.g., for sending via network):

```typescript
// Copy to cache directory
const local = await copyToLocal({ uri: file.uri });
console.log('Local path:', local.path);

// Copy to documents with custom name
const local = await copyToLocal({
  uri: file.uri,
  destination: 'documents',
  filename: 'my-file.pdf',
});
```

### Write Content

```typescript
const content = encodeBase64(new TextEncoder().encode('Hello, World!'));
await writeContent({
  uri: file.uri,
  data: content,
  mimeType: 'text/plain',
});
```

### Release Long-term Access

When you no longer need persistent access to files:

```typescript
await releaseAccess({ uris: [file.uri] });
```

## Platform-Specific Details

### Android

- Uses Storage Access Framework (SAF) for file access
- Returns `content://` URIs that require ContentResolver to read
- Supports persistable URI permissions for long-term access
- Handles virtual files (Google Docs, Sheets, etc.)
- Virtual files can be converted to standard formats (PDF, DOCX, etc.)

### iOS

- Uses UIDocumentPickerViewController
- Two modes: `import` (copy to app sandbox) and `open` (access in place)
- Security-scoped URLs require explicit access/release
- Bookmarks provide persistent access across app launches

## Permissions

Add to your `capabilities/default.json`:

```json
{
  "permissions": [
    "mobile-file-picker:default"
  ]
}
```

Or selectively enable commands:

```json
{
  "permissions": [
    "mobile-file-picker:allow-pick-file",
    "mobile-file-picker:allow-pick-directory",
    "mobile-file-picker:allow-read-content",
    "mobile-file-picker:allow-copy-to-local",
    "mobile-file-picker:allow-write-content",
    "mobile-file-picker:allow-release-access"
  ]
}
```

## API Reference

### Types

| Type | Description |
|------|-------------|
| `FileInfo` | Information about a picked file (uri, path, name, size, mimeType, isVirtual, bookmark) |
| `DirectoryInfo` | Information about a picked directory (uri, path, name, bookmark) |
| `PickerMode` | `'import'` (copy) or `'open'` (access original) |
| `CopyDestination` | `'cache'` or `'documents'` |

### Functions

| Function | Description |
|----------|-------------|
| `pickFile(options?)` | Pick one or more files |
| `pickDirectory(options?)` | Pick a directory |
| `readContent(options)` | Read bytes from a URI |
| `copyToLocal(options)` | Copy URI content to local storage |
| `writeContent(options)` | Write bytes to a URI |
| `releaseAccess(options)` | Release persistent permissions |

### Utility Functions

| Function | Description |
|----------|-------------|
| `decodeBase64(str)` | Decode base64 to Uint8Array |
| `encodeBase64(bytes)` | Encode Uint8Array to base64 |
| `isVirtualFile(file)` | Check if file is virtual (Android) |
| `hasLongTermAccess(file)` | Check if file has bookmark |

## Desktop Support

This plugin is designed for mobile platforms. On desktop, it returns an error suggesting to use `tauri-plugin-dialog` instead.

## License

MIT OR Apache-2.0
