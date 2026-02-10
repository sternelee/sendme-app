# Browser HashSeq Implementation - Testing Guide

## Overview

This guide helps you test the HashSeq implementation that enables browser ↔ CLI/App compatibility.

## What Changed

The browser now uses `BlobFormat::HashSeq` (Collection format) instead of `BlobFormat::Raw`, enabling:
- ✅ Browser → CLI transfers
- ✅ CLI → Browser transfers  
- ✅ Browser → Browser transfers (still works)
- ✅ Filename preservation across all transfers

**Recent Fixes**:
- ✅ Fixed WASM time panic by replacing `std::time::Instant` with iteration-based timeout
- ✅ All WASM-incompatible APIs removed

## Build & Run

```bash
cd browser

# Build WASM (macOS requires LLVM clang)
export CC=/opt/homebrew/opt/llvm/bin/clang
cargo build --target=wasm32-unknown-unknown

# Generate bindings
wasm-bindgen ./target/wasm32-unknown-unknown/debug/pisend_browser.wasm \
  --out-dir=public/wasm --weak-refs --target=web --debug

# Or use the npm script (sets CC automatically)
pnpm run build

# Start dev server
pnpm run serve
```

The server will start on a random port (e.g., `http://localhost:49667`).

## Test Cases

### Test 1: Browser → Browser Transfer

**Purpose**: Verify basic functionality still works with HashSeq format.

**Steps**:
1. Open two browser tabs at `http://localhost:<port>`
2. In Tab 1:
   - Click "Choose File" and select a file (e.g., `test.txt`)
   - Wait for "Ready to send"
   - Copy the ticket string
3. In Tab 2:
   - Paste the ticket into the "Receive" field
   - Click "Receive File"
   - Verify:
     - Download completes successfully
     - Filename is preserved (shows original filename)
     - File content is correct

**Expected Result**: ✅ Transfer works, filename preserved

---

### Test 2: CLI → Browser Transfer

**Purpose**: Verify browser can receive files from CLI (the main compatibility goal).

**Steps**:
1. From terminal, send a file using CLI:
   ```bash
   cd /path/to/iroh-sendmd
   cargo run --bin sendmd send test-file.txt
   ```
   
2. Copy the ticket from CLI output (starts with `blob:`)

3. In browser tab at `http://localhost:<port>`:
   - Paste the ticket into the "Receive" field
   - Click "Receive File"
   - Verify:
     - Download starts and completes
     - Filename matches original (`test-file.txt`)
     - File content is correct

**Expected Result**: ✅ Transfer works, filename preserved

**Troubleshooting**:
- If connection fails, ensure both CLI and browser are on same network
- Check browser console for error messages
- Verify ticket was copied completely

---

### Test 3: Browser → CLI Transfer

**Purpose**: Verify CLI can receive files from browser.

**Steps**:
1. In browser at `http://localhost:<port>`:
   - Click "Choose File" and select a file (e.g., `document.pdf`)
   - Wait for "Ready to send"
   - Copy the ticket string

2. From terminal, receive the file:
   ```bash
   cd /path/to/iroh-sendmd
   cargo run --bin sendmd receive <paste-ticket-here>
   ```

3. Verify:
   - CLI shows download progress
   - File is saved with correct filename in current directory
   - File content is correct

**Expected Result**: ✅ Transfer works, filename preserved

---

### Test 4: Large File Transfer

**Purpose**: Verify large files work correctly.

**Steps**:
1. Create or select a large file (>10MB)
2. Test both directions:
   - Browser → CLI
   - CLI → Browser
3. Verify:
   - Transfer completes without errors
   - Progress indicators work
   - File integrity (compare checksums)

**Expected Result**: ✅ Large files transfer successfully

---

### Test 5: Unicode Filenames

**Purpose**: Verify filename encoding works for non-ASCII characters.

**Steps**:
1. Create test files with various names:
   - `测试文件.txt` (Chinese)
   - `ファイル.txt` (Japanese)
   - `файл.txt` (Cyrillic)
   - `🎉emoji🎊.txt` (Emoji)

2. Test transfers in both directions

3. Verify:
   - Filenames display correctly in browser UI
   - Downloaded files have correct names
   - CLI preserves special characters

**Expected Result**: ✅ Unicode filenames work (or gracefully degrade)

---

### Test 6: Edge Cases

**Purpose**: Test error handling and edge cases.

**Test 6a: Empty Collection**
- Modify code to create empty collection
- Verify error message: "Collection is empty"

**Test 6b: Invalid Ticket**
- Enter malformed ticket in browser
- Verify clear error message

**Test 6c: Network Disconnect**
- Start transfer, disconnect network mid-transfer
- Verify timeout or retry behavior

**Test 6d: Multiple Files (Future)**
- Currently only first file in collection is used
- Document limitation in UI

---

## Verification Checklist

After running all tests, verify:

- [ ] Browser compiles without errors
- [ ] WASM bindings generate successfully  
- [ ] Browser → Browser transfer works
- [ ] Browser → CLI transfer works
- [ ] CLI → Browser transfer works
- [ ] App → Browser transfer works (if testing with Tauri app)
- [ ] Browser → App transfer works (if testing with Tauri app)
- [ ] Filename preserved in all cases
- [ ] Large files (>10MB) work
- [ ] Unicode/special characters in filenames work
- [ ] Error messages are clear and helpful
- [ ] Browser console shows no unexpected errors

## Known Limitations

1. **Multi-file collections**: Browser currently only sends/receives first file from collection
2. **Progress reporting**: Browser shows basic progress, not as detailed as CLI
3. **Directory transfers**: Not supported in browser (only single files)

## Debugging Tips

### Browser Console
Open browser DevTools (F12) → Console tab to see:
- Connection status
- Transfer progress logs
- Error messages

### Network Tab
DevTools → Network tab shows:
- WebRTC connections
- Data transfer activity

### CLI Debug Mode
Run CLI with verbose logging:
```bash
RUST_LOG=debug cargo run --bin sendmd send test.txt
```

### Common Issues

**"Collection is empty" error**:
- Bug in collection creation
- Check browser console for import errors

**Connection timeout**:
- Ensure devices are on same network
- Check firewall settings
- Verify relay server is reachable

**Filename not preserved**:
- Check browser console for Collection.load errors
- Verify ticket format is HashSeq, not Raw

## Next Steps After Testing

1. **Update main README** with browser usage examples
2. **Document compatibility** in project documentation
3. **Add automated tests** (if feasible)
4. **Consider UI improvements**:
   - Show transfer speed
   - Progress bars
   - Better error messages
5. **Performance optimization** for large files
6. **Multi-file support** (if needed)

## Performance Benchmarks (Optional)

Test transfer speeds for various file sizes:

| File Size | Browser→CLI | CLI→Browser | Browser→Browser |
|-----------|-------------|-------------|-----------------|
| 1MB       | ? sec       | ? sec       | ? sec           |
| 10MB      | ? sec       | ? sec       | ? sec           |
| 100MB     | ? sec       | ? sec       | ? sec           |

Record your results to establish baseline performance.
