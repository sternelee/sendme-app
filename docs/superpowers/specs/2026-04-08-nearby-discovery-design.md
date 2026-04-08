# Nearby Discovery - AirDrop-like Experience

**Date:** 2026-04-08  
**Status:** Approved  
**Implementation:** Big Bang (single PR)

---

## Overview

Add a new "Nearby" tab that provides an AirDrop-like experience for local device discovery and transfer. Users can see nearby devices on the same WiFi network, tap to send files, and the receiver sees a manifest review before accepting.

---

## Architecture

### Tab Structure

Add "Nearby" as a new 4th tab alongside existing tabs:

```
Send | Receive | History | Nearby | Settings
```

### Send Flow (Nearby Tab)

```
[Idle] → [Files Selected] → [Device Picked] → [Waiting] → [Transferring] → [Done/Error]
```

| State | UI |
|-------|-----|
| Idle | Drop zone + nearby devices list |
| Files Selected | File manifest + nearby devices |
| Device Picked | "Sending to [device]..." button |
| Waiting | Connection animation, cancel button |
| Transferring | Progress bar, speed, ETA, cancel |
| Done/Error | Result card with Done button |

### Receive Flow (Via existing Receive tab on receiver's device)

```
[Idle] → [Review] → [Receiving] → [Done/Error]
```

| State | UI |
|-------|-----|
| Idle | Normal Receive tab (ticket entry) |
| Review | Manifest card with Accept/Decline |
| Receiving | Progress bar, speed, ETA |
| Done/Error | Result card |

---

## UI Components

### 1. NearbyTab (New Route)

Container component managing the Nearby send flow.

**Location:** `app/src/routes/nearby.tsx`

### 2. DropZone

Drag-and-drop area for file selection.

**States:**
- Default: Dashed border, "Drop files or tap to select"
- Dragover: Highlighted border, "Drop to add"
- Has files: File manifest displayed below

**Props:**
```typescript
interface DropZoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
}
```

### 3. NearbyDeviceList

Horizontal scrolling list of discovered devices.

**Location:** `app/src/lib/components/NearbyDeviceList.tsx`

**States:**
- Scanning: Spinner with "Scanning..."
- Empty: "No devices found on network"
- Has devices: Scrollable tile list
- Error: Error message with retry button

**Device Tile:**
```
┌─────────────┐
│    📱       │
│  iPhone     │
│  iPhone-A1B │
└─────────────┘
```

### 4. FileManifest

List of files with names and sizes.

**Location:** `app/src/lib/components/FileManifest.tsx`

**Used by:** Sender (to review before sending), Receiver (incoming request review)

```typescript
interface FileManifestProps {
  files: Array<{ name: string; size: number; path?: string }>;
  totalSize: number;
  maxHeight?: string;
}
```

### 5. IncomingRequestCard

Incoming transfer request card shown on receiver's device.

**Location:** `app/src/lib/components/IncomingRequestCard.tsx`

**Used by:** Receive tab (shown when incoming nearby request arrives)

**Elements:**
- Sender device name and icon
- File manifest (via FileManifest component)
- Total size
- Accept button (primary)
- Decline button (outline)

**States:**
- Pending: Shows Accept/Decline
- Accepting: Loading spinner, buttons disabled
- Declining: Loading spinner, buttons disabled

```typescript
interface IncomingRequestCardProps {
  request: IncomingRequest;
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
}
```

### 5. TransferProgress

Progress dashboard during transfer.

**Location:** `app/src/lib/components/TransferProgress.tsx`

**Elements:**
- Animated progress bar
- Percentage text
- Speed (e.g., "12.5 MB/s")
- ETA (e.g., "~2 min remaining")
- Cancel button

### 6. ConnectionWaiting

Animated waiting state while receiver reviews.

**Elements:**
- Animated device-to-device connection visualization
- "Waiting for [device] to accept..."
- Cancel button

---

## State Management

Extend `app/src/lib/store.tsx`:

```typescript
// Nearby Send Store
interface NearbySendState {
  files: SelectedFile[];
  nearbyDevices: NearbyDevice[];
  discoveryState: 'idle' | 'scanning' | 'error';
  selectedDevice: NearbyDevice | null;
  transferState: 'idle' | 'selected' | 'picked' | 'waiting' | 'transferring' | 'done' | 'error';
  transferProgress: TransferProgress | null;
  error: string | null;
}

// Nearby Receive Store (for incoming requests)
interface NearbyReceiveState {
  incomingRequest: IncomingRequest | null;
  transferState: 'idle' | 'review' | 'receiving' | 'done' | 'error';
  transferProgress: TransferProgress | null;
  error: string | null;
}
```

---

## Tauri Commands

Extend `app/src-tauri/src/lib.rs` with new commands:

### Send Commands (already exist in sendme-lib, need bindings)
- `start_nearby_discovery()` - Start mDNS scanning
- `get_nearby_devices()` - Get current device list
- `stop_nearby_discovery()` - Stop scanning
- `send_to_device(files: Vec<String>, device: NearbyDevice)` - Initiate transfer

### Receive Commands
- `accept_incoming(request_id: String)` - Accept pending transfer
- `decline_incoming(request_id: String)` - Decline pending transfer

### Progress Events (already exist)
- `progress` event emitted during transfer

---

## Transfer Protocol

### Discovery
- Uses mDNS with service type `_iroh._tcp` (follows iroh convention)
- Devices broadcast their presence on local network
- Each device has a stable `id` used for connection routing

### Connection & Transfer Flow

```
Sender                          Receiver
  |                                |
  |-- [TCP/QUIC direct connect] -->|
  |   or via iroh relay            |
  |                                |
  |-- Manifest Request ----------->|
  |<-- Manifest Response -----------|
  |                                |
  |    [Waiting for user action]   |
  |                                |
  |<---- Accept/Decline -----------|
  |                                |
  |-- [If Accept] File Data ------>|
  |                                |
  |<--- Progress Updates ----------|
  |                                |
  |-- [Complete] ----------------->|
```

### Request Routing
- `deviceId` is a stable identifier routed through iroh's relay system
- System attempts direct connection first (same network)
- Falls back to relay connection if NAT traversal fails
- Receiver can handle one transfer at a time

### Request Timeout
- If receiver doesn't respond within **60 seconds**, sender gets timeout error
- Error message: "No response from [device]. They may have left or be busy."
- Receiver sees: request auto-dismisses after 60 seconds if not acted upon

---

## Bindings

Extend `app/src/lib/bindings.ts`:

```typescript
interface NearbyDevice {
  id: string;
  name: string;
  deviceType: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'unknown';
}

interface IncomingRequest {
  id: string;
  senderName: string;
  files: Array<{ name: string; size: number }>;
  totalSize: number;
}

interface TransferProgress {
  transferred: number;
  total: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}

// Commands
async function startNearbyDiscovery(): Promise<void>;
async function getNearbyDevices(): Promise<NearbyDevice[]>;
async function stopNearbyDiscovery(): Promise<void>;
async function sendToDevice(filePaths: string[], deviceId: string): Promise<string>;
async function acceptIncoming(requestId: string): Promise<void>;
async function declineIncoming(requestId: string): Promise<void>;
```

---

## File Structure

```
app/src/
├── routes/
│   └── nearby.tsx          # New Nearby tab route
├── lib/
│   ├── components/
│   │   ├── DropZone.tsx           # Used by Nearby tab (sender)
│   │   ├── NearbyDeviceList.tsx    # Used by Nearby tab (sender)
│   │   ├── FileManifest.tsx       # Used by Nearby tab (sender) & Receive tab (receiver)
│   │   ├── IncomingRequestCard.tsx # Used by Receive tab (receiver)
│   │   ├── TransferProgress.tsx    # Used by both sender & receiver
│   │   └── ConnectionWaiting.tsx  # Used by Nearby tab (sender only)
│   ├── store.tsx           # Extended with nearby state
│   └── bindings.ts        # Extended with nearby bindings
```

---

## Dependencies

All dependencies already available:
- `@tauri-apps/api` - Tauri bindings
- `solid-js` - UI framework
- `tailwindcss` v4 + `daisyui` - Styling
- `lucide-solid` - Icons

---

## Error Handling

| Error | User Message |
|-------|--------------|
| Discovery failed | "Couldn't find nearby devices. Make sure you're on the same WiFi network." |
| Device disconnected | "Device disconnected. Please try again." |
| Transfer failed | "Transfer failed: [reason]. Tap to retry." |
| Receiver declined | "[Device] declined the transfer." |
| Request timeout | "No response from [device]. They may have left or be busy." |
| Receiver busy | "[device] is currently receiving another transfer. Try again when they're free." |
| App backgrounded | Transfer continues in background. If terminated, transfer fails. |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Multiple senders | Receiver sees multiple IncomingRequestCards. Can Accept one, must Decline others. |
| Sender app backgrounded during Wait | Transfer continues if connection established. If lost, shows error. |
| Receiver in another transfer | Sender sees "Device busy" when attempting to send. |
| Network change | If devices change networks during discovery, rescan required. |

---

## Cancellation

Both sender and receiver can cancel:
- Cancel button available during Waiting and Transferring states
- Confirmation dialog: "Cancel this transfer?"
- On cancel: Clean up state, return to Idle

---

## Testing Checklist

- [ ] Nearby tab renders correctly
- [ ] Device discovery starts automatically on tab visit
- [ ] Devices appear within 3-5 seconds on same network
- [ ] File selection via drop and picker works
- [ ] Tapping device initiates transfer
- [ ] Receiver sees manifest and Accept/Decline
- [ ] Progress bar updates smoothly
- [ ] Speed and ETA display correctly
- [ ] Cancel works on both sides
- [ ] Completion shows success state
- [ ] Error states display appropriate messages
- [ ] Works with 1 file, multiple files, folders
- [ ] Works on dark theme
- [ ] Works on mobile viewport
- [ ] Receiver busy with another transfer → appropriate message shown
- [ ] Request timeout after 60 seconds
- [ ] Multiple senders → can accept one, decline others
