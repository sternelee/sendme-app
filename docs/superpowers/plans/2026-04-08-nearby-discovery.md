# Nearby Discovery - AirDrop-like Experience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Nearby" tab providing AirDrop-like experience for local device discovery and transfer

**Architecture:** 
- Rust backend: Add nearby discovery to sendme-lib using mDNS, expose via Tauri commands
- Frontend: New Nearby tab route with DropZone, DeviceList, TransferProgress components
- Extend existing Receive tab to handle incoming nearby requests via Tauri events

**Tech Stack:** SolidJS, Tailwind CSS v4, DaisyUI, Tauri, iroh

---

## Chunk 1: Rust Backend - Nearby Discovery in sendme-lib

**Files:**
- Create: `lib/src/nearby.rs` - New module for nearby discovery
- Modify: `lib/src/lib.rs` - Export the new module
- Modify: `lib/Cargo.toml` - Add mdns dependency

- [ ] **Step 1: Add mDNS dependency to lib/Cargo.toml**

Note: `serde`, `tracing` are already in dependencies.

```toml
[dependencies]
# ... existing dependencies ...
mdns-sd = "0.10"  # For mDNS discovery
```

- [ ] **Step 2: Create lib/src/nearby.rs**

```rust
//! Nearby device discovery using mDNS
//!
//! Discovers other sendme instances on the local network using the `_iroh._tcp` service type.

use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// A discovered nearby device
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NearbyDevice {
    /// Unique identifier for the device (used for connection)
    pub id: String,
    /// Human-readable device name
    pub name: String,
    /// Device type hint
    pub device_type: DeviceType,
    /// Connection addresses
    pub addresses: Vec<String>,
}

/// Device type hint
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Phone,
    Tablet,
    Laptop,
    Desktop,
    Unknown,
}

impl From<&str> for DeviceType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "phone" | "mobile" => DeviceType::Phone,
            "tablet" => DeviceType::Tablet,
            "laptop" | "notebook" => DeviceType::Laptop,
            "desktop" => DeviceType::Desktop,
            _ => DeviceType::Unknown,
        }
    }
}

/// Service type for iroh discovery (mdns-sd adds .local. automatically)
pub const SERVICE_TYPE: &str = "_iroh._tcp";

/// Discovers nearby sendme instances
pub struct NearbyDiscovery {
    daemon: ServiceDaemon,
    services: Arc<Mutex<HashMap<String, ServiceInfo>>>,
}

impl NearbyDiscovery {
    /// Create a new discovery instance
    pub fn new() -> Result<Self> {
        let daemon = ServiceDaemon::new()?;
        Ok(Self {
            daemon,
            services: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Start browsing for services
    pub fn browse(&self) -> Result<()> {
        let service_type = SERVICE_TYPE.to_string();
        let services = self.services.clone();
        
        // Note: mdns-sd automatically appends ".local." to the service type
        self.daemon.browse(service_type.as_str(), move |event| {
            match event {
                ServiceEvent::ServiceFound(_, info) => {
                    if let Some(name) = info.get_name() {
                        if let Ok(mut services) = services.lock() {
                            services.insert(name.to_string(), info);
                        }
                    }
                }
                ServiceEvent::ServiceRemoved(_, name) => {
                    if let Ok(mut services) = services.lock() {
                        services.remove(name);
                    }
                }
                ServiceEvent::BrowseFailed(e) => {
                    tracing::error!("mDNS browse failed: {:?}", e);
                }
                _ => {}
            }
        })?;
        Ok(())
    }

    /// Get all discovered devices
    pub fn get_devices(&self) -> Vec<NearbyDevice> {
        let services = match self.services.lock() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        services
            .values()
            .filter_map(|info| {
                // Use the full service name (instance + type) as the unique id
                let name = info.get_name()?;
                let full_name = info.get_fullname()?;
                let id = full_name.to_string();
                let addresses: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|addr| format!("{}:{}", addr, info.get_port()))
                    .collect();
                
                // Try to get device type from properties
                let device_type = info
                    .get_properties()
                    .and_then(|props| props.get("type"))
                    .map(|t| DeviceType::from(t.as_str()))
                    .unwrap_or(DeviceType::Unknown);

                Some(NearbyDevice {
                    id,
                    name: name.to_string(),
                    device_type,
                    addresses,
                })
            })
            .collect()
    }
}

impl Default for NearbyDiscovery {
    fn default() -> Self {
        match Self::new() {
            Ok(n) => n,
            Err(e) => {
                tracing::error!("Failed to create NearbyDiscovery: {}", e);
                panic!("NearbyDiscovery creation failed: {}", e)
            }
        }
    }
}
```

- [ ] **Step 3: Update lib/src/lib.rs to export nearby module**

```rust
pub mod nearby;
pub mod export;
pub mod import;
pub mod progress;
pub mod receive;
pub mod send;
pub mod types;

pub use nearby::{NearbyDevice, NearbyDiscovery, DeviceType, SERVICE_TYPE};
```

- [ ] **Step 4: Build to verify**

Run: `cargo build -p sendme-lib`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add lib/src/nearby.rs lib/src/lib.rs lib/Cargo.toml
git commit -m "feat(lib): Add mDNS-based nearby discovery module"
```

---

## Chunk 2: Tauri Backend - Commands & Events

**Files:**
- Modify: `app/src-tauri/src/lib.rs` - Add nearby discovery commands

- [ ] **Step 1: Add NearbyDiscovery to app state**

Add to the state management section after `type Transfers = Arc<RwLock<HashMap<String, TransferState>>>;`:

```rust
// Nearby discovery state
type NearbyDiscoveryState = Arc<Mutex<Option<sendme_lib::NearbyDiscovery>>>;
```

- [ ] **Step 2: Add nearby discovery Tauri commands**

```rust
#[tauri::command]
async fn start_nearby_discovery(
    app: AppHandle,
    discovery: tauri::State<'_, NearbyDiscoveryState>,
) -> Result<(), String> {
    let mut guard = discovery.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // Already running
    }
    let new_discovery = sendme_lib::NearbyDiscovery::new()
        .map_err(|e| e.to_string())?;
    new_discovery.browse().map_err(|e| e.to_string())?;
    *guard = Some(new_discovery);
    Ok(())
}

#[tauri::command]
async fn get_nearby_devices(
    discovery: tauri::State<'_, NearbyDiscoveryState>,
) -> Result<Vec<sendme_lib::NearbyDevice>, String> {
    let guard = discovery.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(d) => Ok(d.get_devices()),
        None => Ok(vec![]),
    }
}

#[tauri::command]
async fn stop_nearby_discovery(
    discovery: tauri::State<'_, NearbyDiscoveryState>,
) -> Result<(), String> {
    let mut guard = discovery.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
```

- [ ] **Step 3: Add incoming request handling commands**

Note: These are placeholder implementations. The actual transfer protocol requires additional design for how sender/receiver communicate the manifest before transfer begins.

```rust
#[tauri::command]
async fn send_to_device(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    file_paths: Vec<String>,
    device_id: String,
) -> Result<String, String> {
    // TODO: Implementation requires defining the transfer protocol
    // For MVP, return an error indicating not yet implemented
    Err("send_to_device not yet implemented".to_string())
}

#[tauri::command]
async fn accept_incoming(
    request_id: String,
) -> Result<(), String> {
    // TODO: Implementation requires connection state tracking
    Err("accept_incoming not yet implemented".to_string())
}

#[tauri::command]
async fn decline_incoming(
    request_id: String,
) -> Result<(), String> {
    // TODO: Implementation requires connection state tracking
    Err("decline_incoming not yet implemented".to_string())
}
```

Note: The Rust implementation for these commands will be completed in a future iteration after the transfer protocol is defined. The UI components are complete and ready to be wired up.

- [ ] **Step 4: Update invoke_handler to include new commands**

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    start_nearby_discovery,
    get_nearby_devices,
    stop_nearby_discovery,
    send_to_device,
    accept_incoming,
    decline_incoming,
])
```

- [ ] **Step 5: Build to verify**

Run: `cargo build -p app`
Expected: BUILD SUCCESSFUL (with warnings about `todo!()` implementations)

Note: The `send_to_device`, `accept_incoming`, and `decline_incoming` commands currently return errors indicating they are not yet implemented. The UI is complete but the transfer protocol needs additional design work.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/lib.rs
git commit -m "feat(tauri): Add nearby discovery commands (placeholder implementations)"
```

---

## Chunk 3: Frontend - TypeScript Bindings

**Files:**
- Modify: `app/src/bindings.ts` - Add nearby-related types and commands

- [ ] **Step 1: Add nearby types**

```typescript
/**
 * Nearby device information
 */
export interface NearbyDevice {
  id: string;
  name: string;
  deviceType: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
  addresses: string[];
}

/**
 * Incoming transfer request from a nearby device
 */
export interface IncomingRequest {
  id: string;
  senderName: string;
  files: Array<{ name: string; size: number }>;
  totalSize: number;
}

/**
 * Transfer progress information
 */
export interface TransferProgress {
  transferred: number;
  total: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}
```

- [ ] **Step 2: Add nearby commands**

```typescript
/**
 * Start scanning for nearby devices
 */
export async function start_nearby_discovery(): Promise<void> {
  return await invoke("start_nearby_discovery");
}

/**
 * Get list of nearby devices
 */
export async function get_nearby_devices(): Promise<NearbyDevice[]> {
  return await invoke("get_nearby_devices");
}

/**
 * Stop scanning for nearby devices
 */
export async function stop_nearby_discovery(): Promise<void> {
  return await invoke("stop_nearby_discovery");
}

/**
 * Send files to a nearby device
 */
export async function send_to_device(
  filePaths: string[],
  deviceId: string
): Promise<string> {
  return await invoke("send_to_device", { filePaths, deviceId });
}

/**
 * Accept an incoming transfer request
 */
export async function accept_incoming(requestId: string): Promise<void> {
  return await invoke("accept_incoming", { requestId });
}

/**
 * Decline an incoming transfer request
 */
export async function decline_incoming(requestId: string): Promise<void> {
  return await invoke("decline_incoming", { requestId });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/bindings.ts
git commit -m "feat(bindings): Add nearby discovery TypeScript bindings"
```

---

## Chunk 4: Frontend - Store Extensions

**Files:**
- Modify: `app/src/lib/store.tsx` - Add nearby state

- [ ] **Step 1: Add NearbySendState interface**

```typescript
export interface NearbySendState {
  files: SelectedFile[];
  nearbyDevices: NearbyDevice[];
  discoveryState: 'idle' | 'scanning' | 'error';
  selectedDevice: NearbyDevice | null;
  transferState: 'idle' | 'selected' | 'picked' | 'waiting' | 'transferring' | 'done' | 'error';
  transferProgress: TransferProgress | null;
  error: string | null;
}

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
}
```

- [ ] **Step 2: Add NearbyReceiveState interface**

```typescript
export interface NearbyReceiveState {
  incomingRequest: IncomingRequest | null;
  transferState: 'idle' | 'review' | 'receiving' | 'done' | 'error';
  transferProgress: TransferProgress | null;
  error: string | null;
}
```

- [ ] **Step 3: Extend GlobalStoreValue and GlobalStore**

Add to `GlobalStoreValue`:
```typescript
nearbySend: NearbySendState;
nearbyReceive: NearbyReceiveState;
```

Add to `GlobalStore`:
```typescript
nearbySend: {
  state: Accessor<NearbySendState>;
  setFiles: (files: SelectedFile[]) => void;
  setNearbyDevices: (devices: NearbyDevice[]) => void;
  setDiscoveryState: (state: 'idle' | 'scanning' | 'error') => void;
  setSelectedDevice: (device: NearbyDevice | null) => void;
  setTransferState: (state: NearbySendState['transferState']) => void;
  setTransferProgress: (progress: TransferProgress | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};
nearbyReceive: {
  state: Accessor<NearbyReceiveState>;
  setIncomingRequest: (request: IncomingRequest | null) => void;
  setTransferState: (state: NearbyReceiveState['transferState']) => void;
  setTransferProgress: (progress: TransferProgress | null) => void;
  setError: (error: string | null) => void;
};
```

- [ ] **Step 4: Add default states**

```typescript
const defaultNearbySendState: NearbySendState = {
  files: [],
  nearbyDevices: [],
  discoveryState: 'idle',
  selectedDevice: null,
  transferState: 'idle',
  transferProgress: null,
  error: null,
};

const defaultNearbyReceiveState: NearbyReceiveState = {
  incomingRequest: null,
  transferState: 'idle',
  transferProgress: null,
  error: null,
};
```

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/store.tsx
git commit -m "feat(store): Add nearby discovery state management"
```

---

## Chunk 5: Frontend - UI Components

**Files:**
- Create: `app/src/lib/components/DropZone.tsx`
- Create: `app/src/lib/components/NearbyDeviceList.tsx`
- Create: `app/src/lib/components/FileManifest.tsx`
- Create: `app/src/lib/components/TransferProgress.tsx`
- Create: `app/src/lib/components/ConnectionWaiting.tsx`
- Create: `app/src/lib/components/IncomingRequestCard.tsx`

- [ ] **Step 1: Create DropZone.tsx**

```tsx
import { Component, Show, For, createSignal } from "solid-js";
import { Upload, X } from "lucide-solid";
import { formatFileSize } from "~/lib/utils";

interface DropZoneProps {
  files: Array<{ name: string; size: number; path?: string }>;
  onFilesSelected: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
}

export const DropZone: Component<DropZoneProps> = (props) => {
  const [isDragover, setIsDragover] = createSignal(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragover(false);
    // Handle file drop
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      props.onFilesSelected(files);
    }
  };

  return (
    <div
      class={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
        isDragover()
          ? "border-primary bg-primary/5"
          : "border-base-300 bg-base-300/30 hover:border-primary/50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragover(true); }}
      onDragLeave={() => setIsDragover(false)}
      onDrop={handleDrop}
    >
      <Show
        when={props.files.length === 0}
        fallback={
          <div class="space-y-2">
            <For each={props.files}>
              {(file, index) => (
                <div class="flex items-center justify-between bg-base-200 rounded-lg px-3 py-2">
                  <span class="text-sm truncate">{file.name}</span>
                  <span class="text-xs opacity-60">{formatFileSize(file.size)}</span>
                  <Show when={props.onRemoveFile}>
                    <button
                      onClick={() => props.onRemoveFile?.(index())}
                      class="btn btn-ghost btn-xs"
                    >
                      <X size={14} />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        }
      >
        <Upload size={32} class="mx-auto mb-2 opacity-40" />
        <p class="text-sm opacity-60">
          {isDragover() ? "Drop files here" : "Drop files or tap to select"}
        </p>
      </Show>
    </div>
  );
};
```

- [ ] **Step 2: Create NearbyDeviceList.tsx**

```tsx
import { Component, Show, For } from "solid-js";
import { Smartphone, Laptop, Monitor, Tablet, RefreshCw } from "lucide-solid";

interface NearbyDevice {
  id: string;
  name: string;
  deviceType: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
}

interface NearbyDeviceListProps {
  devices: NearbyDevice[];
  isScanning: boolean;
  selectedDeviceId: string | null;
  onDeviceSelect: (device: NearbyDevice) => void;
  onRefresh: () => void;
  error?: string | null;
}

const DeviceIcon: Component<{ type: string }> = (props) => {
  switch (props.type) {
    case "phone": return <Smartphone size={24} />;
    case "tablet": return <Tablet size={24} />;
    case "laptop": return <Laptop size={24} />;
    case "desktop": return <Monitor size={24} />;
    default: return <Laptop size={24} />;
  }
};

export const NearbyDeviceList: Component<NearbyDeviceListProps> = (props) => {
  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium opacity-60">Nearby Devices</span>
        <button
          onClick={props.onRefresh}
          class={`btn btn-ghost btn-xs ${props.isScanning ? "loading" : ""}`}
          disabled={props.isScanning}
        >
          <RefreshCw size={14} class={props.isScanning ? "animate-spin" : ""} />
        </button>
      </div>

      <Show when={props.error}>
        <div class="text-error text-sm">{props.error}</div>
      </Show>

      <Show
        when={!props.isScanning || props.devices.length > 0}
        fallback={
          <div class="flex items-center justify-center py-8">
            <span class="loading loading-spinner loading-sm text-primary"></span>
            <span class="ml-2 text-sm opacity-60">Scanning...</span>
          </div>
        }
      >
        <Show
          when={props.devices.length > 0}
          fallback={
            <div class="text-center py-8 opacity-40">
              <p class="text-sm">No devices found on network</p>
              <p class="text-xs mt-1">Make sure other devices are running Sendme</p>
            </div>
          }
        >
          <div class="flex gap-3 overflow-x-auto pb-2">
            <For each={props.devices}>
              {(device) => (
                <button
                  onClick={() => props.onDeviceSelect(device)}
                  class={`flex-shrink-0 flex flex-col items-center p-4 rounded-xl border-2 transition-colors ${
                    props.selectedDeviceId === device.id
                      ? "border-primary bg-primary/10"
                      : "border-base-300 bg-base-200 hover:border-primary/50"
                  }`}
                >
                  <DeviceIcon type={device.deviceType} />
                  <span class="mt-2 text-xs font-medium">{device.name}</span>
                  <span class="text-xs opacity-40">{device.id.slice(0, 8)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};
```

- [ ] **Step 3: Create FileManifest.tsx**

```tsx
import { Component, For, Show } from "solid-js";
import { formatFileSize } from "~/lib/utils";

interface FileManifestProps {
  files: Array<{ name: string; size: number }>;
  totalSize: number;
  maxHeight?: string;
}

export const FileManifest: Component<FileManifestProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-3 space-y-2">
      <div class="flex justify-between text-xs font-medium opacity-60">
        <span>{props.files.length} file{props.files.length !== 1 ? "s" : ""}</span>
        <span>{formatFileSize(props.totalSize)}</span>
      </div>
      <div
        class={`space-y-1 overflow-y-auto ${props.maxHeight || ""}`}
        style={props.maxHeight ? { "max-height": props.maxHeight } : {}}
      >
        <For each={props.files}>
          {(file) => (
            <div class="flex justify-between text-sm">
              <span class="truncate">{file.name}</span>
              <span class="text-xs opacity-60 ml-2">{formatFileSize(file.size)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Create TransferProgress.tsx**

```tsx
import { Component, Show } from "solid-js";
import { X, Loader2 } from "lucide-solid";
import { formatFileSize } from "~/lib/utils";

interface TransferProgressProps {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isReceiving?: boolean;
  onCancel: () => void;
}

export const TransferProgress: Component<TransferProgressProps> = (props) => {
  const percent = () => Math.round((props.transferred / props.total) * 100);
  const speedStr = () => formatFileSize(props.speed) + "/s";
  const etaStr = () => {
    if (props.eta < 60) return "~0 min";
    if (props.eta < 3600) return `~${Math.round(props.eta / 60)} min`;
    return `~${Math.round(props.eta / 3600)} hr`;
  };

  return (
    <div class="bg-base-200 rounded-lg p-4 space-y-3">
      <div class="flex justify-between text-sm font-medium">
        <span>{percent()}%</span>
        <span class="opacity-60">{speedStr()}</span>
      </div>
      <progress
        class={`progress w-full ${props.isReceiving ? "progress-secondary" : "progress-primary"}`}
        value={props.transferred}
        max={props.total}
      ></progress>
      <div class="flex justify-between text-xs opacity-60">
        <span>{formatFileSize(props.transferred)} / {formatFileSize(props.total)}</span>
        <span>{etaStr()} remaining</span>
      </div>
      <button onClick={props.onCancel} class="btn btn-ghost btn-sm text-error w-full mt-2">
        <X size={14} class="mr-1" /> Cancel
      </button>
    </div>
  );
};
```

- [ ] **Step 5: Create ConnectionWaiting.tsx**

```tsx
import { Component } from "solid-js";
import { Loader2 } from "lucide-solid";

interface ConnectionWaitingProps {
  deviceName: string;
  onCancel: () => void;
}

export const ConnectionWaiting: Component<ConnectionWaitingProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-6 text-center space-y-4">
      <div class="flex justify-center">
        <div class="relative">
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-16 h-16 rounded-full border-4 border-base-300"></div>
          </div>
          <div class="relative flex items-center justify-center w-16 h-16">
            <Loader2 size={32} class="animate-spin text-primary" />
          </div>
        </div>
      </div>
      <div class="space-y-1">
        <p class="font-medium">Waiting for {props.deviceName} to accept...</p>
        <p class="text-xs opacity-60">They'll see a preview of your files</p>
      </div>
      <button onClick={props.onCancel} class="btn btn-outline btn-sm">
        Cancel
      </button>
    </div>
  );
};
```

- [ ] **Step 6: Create IncomingRequestCard.tsx**

```tsx
import { Component, Show } from "solid-js";
import { Check, X, Loader2 } from "lucide-solid";
import { FileManifest } from "./FileManifest";

interface IncomingRequestCardProps {
  request: {
    id: string;
    senderName: string;
    files: Array<{ name: string; size: number }>;
    totalSize: number;
  };
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  state?: "pending" | "accepting" | "declining";
}

export const IncomingRequestCard: Component<IncomingRequestCardProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-4 space-y-4">
      <div class="flex items-center gap-3">
        <div class="avatar placeholder">
          <div class="bg-secondary/20 text-secondary rounded-full w-12">
            <span class="text-lg">📱</span>
          </div>
        </div>
        <div>
          <p class="font-medium">{props.request.senderName}</p>
          <p class="text-xs opacity-60">wants to send you files</p>
        </div>
      </div>

      <FileManifest
        files={props.request.files}
        totalSize={props.request.totalSize}
        maxHeight="120px"
      />

      <Show when={props.state === "accepting"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="animate-spin text-primary mr-2" />
          <span class="text-sm">Accepting...</span>
        </div>
      </Show>

      <Show when={props.state === "declining"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="animate-spin text-error mr-2" />
          <span class="text-sm">Declining...</span>
        </div>
      </Show>

      <Show when={!props.state || props.state === "pending"}>
        <div class="flex gap-2">
          <button
            onClick={props.onDecline}
            disabled={props.disabled}
            class="btn btn-outline flex-1"
          >
            <X size={16} class="mr-1" /> Decline
          </button>
          <button
            onClick={props.onAccept}
            disabled={props.disabled}
            class="btn btn-secondary flex-1"
          >
            <Check size={16} class="mr-1" /> Accept
          </button>
        </div>
      </Show>
    </div>
  );
};
```

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/components/DropZone.tsx
git add app/src/lib/components/NearbyDeviceList.tsx
git add app/src/lib/components/FileManifest.tsx
git add app/src/lib/components/TransferProgress.tsx
git add app/src/lib/components/ConnectionWaiting.tsx
git add app/src/lib/components/IncomingRequestCard.tsx
git commit -m "feat(components): Add nearby discovery UI components"
```

---

## Chunk 6: Frontend - Nearby Tab Route

**Files:**
- Create: `app/src/routes/nearby.tsx`

- [ ] **Step 1: Create the Nearby tab route**

```tsx
import { Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useGlobalStore } from "~/lib/store";
import {
  start_nearby_discovery,
  get_nearby_devices,
  stop_nearby_discovery,
  send_to_device,
  type NearbyDevice,
} from "~/bindings";
import { DropZone } from "~/lib/components/DropZone";
import { NearbyDeviceList } from "~/lib/components/NearbyDeviceList";
import { FileManifest } from "~/lib/components/FileManifest";
import { TransferProgress } from "~/lib/components/TransferProgress";
import { ConnectionWaiting } from "~/lib/components/ConnectionWaiting";
import { formatFileSize } from "~/lib/utils";
import { toast } from "solid-sonner";
import { Radio } from "lucide-solid";

interface SelectedFile {
  name: string;
  size: number;
  path: string;
}

interface TransferProgressData {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
}

export default function NearbyPage() {
  const store = useGlobalStore();
  const [selectedFiles, setSelectedFiles] = createSignal<SelectedFile[]>([]);
  const [nearbyDevices, setNearbyDevices] = createSignal<NearbyDevice[]>([]);
  const [isScanning, setIsScanning] = createSignal(false);
  const [selectedDevice, setSelectedDevice] = createSignal<NearbyDevice | null>(null);
  const [transferState, setTransferState] = createSignal<
    "idle" | "waiting" | "transferring" | "done" | "error"
  >("idle");
  const [progress, setProgress] = createSignal<TransferProgressData | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let discoveryInterval: ReturnType<typeof setInterval>;

  onMount(async () => {
    try {
      await start_nearby_discovery();
      setIsScanning(true);
      discoveryInterval = setInterval(async () => {
        try {
          const devices = await get_nearby_devices();
          setNearbyDevices(devices);
        } catch (e) {
          console.error("Failed to get nearby devices:", e);
        }
      }, 2000);
    } catch (e) {
      setError("Failed to start discovery");
      setIsScanning(false);
    }
  });

  onCleanup(async () => {
    if (discoveryInterval) clearInterval(discoveryInterval);
    try {
      await stop_nearby_discovery();
    } catch (e) {}
  });

  const handleFilesSelected = (files: File[]) => {
    const fileInfos: SelectedFile[] = files.map((f) => ({
      name: f.name,
      size: f.size,
      path: (f as unknown as { path?: string }).path || f.name,
    }));
    setSelectedFiles(fileInfos);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeviceSelect = async (device: NearbyDevice) => {
    if (selectedFiles().length === 0) {
      toast.error("Please select files first");
      return;
    }
    setSelectedDevice(device);
    setTransferState("waiting");
    try {
      await send_to_device(
        selectedFiles().map((f) => f.path),
        device.id
      );
    } catch (e) {
      setError(`Failed to send: ${e}`);
      setTransferState("error");
    }
  };

  const handleRefresh = async () => {
    setIsScanning(true);
    try {
      const devices = await get_nearby_devices();
      setNearbyDevices(devices);
    } catch (e) {
      toast.error(`Refresh failed: ${e}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCancel = () => {
    setSelectedDevice(null);
    setTransferState("idle");
    setProgress(null);
    setError(null);
  };

  const handleDone = () => {
    setSelectedFiles([]);
    setSelectedDevice(null);
    setTransferState("idle");
    setProgress(null);
    setError(null);
  };

  const totalSize = () => selectedFiles().reduce((sum, f) => sum + f.size, 0);

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-bold text-base-content/60 uppercase tracking-wider">
        Nearby
      </h2>

      {/* Drop Zone */}
      <DropZone
        files={selectedFiles()}
        onFilesSelected={handleFilesSelected}
        onRemoveFile={handleRemoveFile}
      />

      {/* Device List */}
      <NearbyDeviceList
        devices={nearbyDevices()}
        isScanning={isScanning()}
        selectedDeviceId={selectedDevice()?.id}
        onDeviceSelect={handleDeviceSelect}
        onRefresh={handleRefresh}
        error={error()}
      />

      {/* File Manifest (when files selected) */}
      <Show when={selectedFiles().length > 0 && transferState() === "idle"}>
        <FileManifest files={selectedFiles()} totalSize={totalSize()} />
      </Show>

      {/* Waiting State */}
      <Show when={transferState() === "waiting" && selectedDevice()}>
        <ConnectionWaiting
          deviceName={selectedDevice().name}
          onCancel={handleCancel}
        />
      </Show>

      {/* Transfer Progress */}
      <Show when={transferState() === "transferring" && progress()}>
        <TransferProgress
          transferred={progress().transferred}
          total={progress().total}
          speed={progress().speed}
          eta={progress().eta}
          onCancel={handleCancel}
        />
      </Show>

      {/* Done State */}
      <Show when={transferState() === "done"}>
        <div class="bg-success/10 border border-success/20 rounded-lg p-4 text-center">
          <p class="font-medium text-success">Transfer Complete!</p>
          <button onClick={handleDone} class="btn btn-success btn-sm mt-2">
            Done
          </button>
        </div>
      </Show>

      {/* Error State */}
      <Show when={transferState() === "error"}>
        <div class="bg-error/10 border border-error/20 rounded-lg p-4 text-center">
          <p class="font-medium text-error">{error()}</p>
          <button onClick={handleCancel} class="btn btn-error btn-sm mt-2">
            Try Again
          </button>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Add Nearby tab to routes/index.tsx**

Add to the tabs dock:

```tsx
<button
  class={`dock-label ${activeTab() === "nearby" ? "active" : ""}`}
  onClick={() => setActiveTab("nearby")}
>
  <Radio size={24} />
  <span>Nearby</span>
</button>
```

Import the NearbyPage component and add the route:

```tsx
import NearbyPage from "./nearby";

<Match when={activeTab() === "nearby"}>
  <NearbyPage />
</Match>
```

Add Radio icon to imports from lucide-solid.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/nearby.tsx app/src/routes/index.tsx
git commit -m "feat(nearby): Add Nearby tab route"
```

---

## Chunk 7: Frontend - Receive Tab Integration for Incoming Requests

**Files:**
- Modify: `app/src/routes/index.tsx` - Handle incoming nearby requests

- [ ] **Step 1: Listen for incoming_nearby_request event**

Add to the `onMount` function:

```typescript
const unlistenNearby = await listen("incoming_nearby_request", (event) => {
  const request = event.payload as IncomingRequest;
  store.nearbyReceive.setIncomingRequest(request);
  store.nearbyReceive.setTransferState("review");
});

const unlistenNearbyCancel = await listen("nearby_request_cancelled", (event) => {
  if (store.nearbyReceive.state().incomingRequest?.id === event.payload.requestId) {
    store.nearbyReceive.setIncomingRequest(null);
    store.nearbyReceive.setTransferState("idle");
    toast.info("Sender cancelled the request");
  }
});

const unlistenNearbyDecline = await listen("nearby_request_declined", (event) => {
  if (store.nearbyReceive.state().incomingRequest?.id === event.payload.requestId) {
    store.nearbyReceive.setIncomingRequest(null);
    store.nearbyReceive.setTransferState("idle");
    toast.info("Request declined");
  }
});
```

Add to `onCleanup`:

```typescript
unlistenNearby();
unlistenNearbyCancel();
unlistenNearbyDecline();
```

- [ ] **Step 2: Add IncomingRequestCard to Receive tab**

In the Receive tab section, add after the existing receive UI:

```tsx
<Show when={store.nearbyReceive.state().incomingRequest}>
  <IncomingRequestCard
    request={store.nearbyReceive.state().incomingRequest!}
    onAccept={async () => {
      try {
        await accept_incoming(store.nearbyReceive.state().incomingRequest!.id);
        store.nearbyReceive.setTransferState("receiving");
      } catch (e) {
        toast.error(`Failed to accept: ${e}`);
      }
    }}
    onDecline={async () => {
      try {
        await decline_incoming(store.nearbyReceive.state().incomingRequest!.id);
        store.nearbyReceive.setIncomingRequest(null);
        store.nearbyReceive.setTransferState("idle");
      } catch (e) {
        toast.error(`Failed to decline: ${e}`);
      }
    }}
    disabled={store.nearbyReceive.state().transferState !== "review"}
    state={store.nearbyReceive.state().transferState === "receiving" ? "accepting" : "pending"}
  />
</Show>

<Show when={store.nearbyReceive.state().transferState === "receiving" && store.nearbyReceive.state().transferProgress}>
  <TransferProgress
    transferred={store.nearbyReceive.state().transferProgress!.transferred}
    total={store.nearbyReceive.state().transferProgress!.total}
    speed={store.nearbyReceive.state().transferProgress!.speed}
    eta={store.nearbyReceive.state().transferProgress!.eta}
    isReceiving={true}
    onCancel={async () => {
      // Cancel the transfer
      store.nearbyReceive.setIncomingRequest(null);
      store.nearbyReceive.setTransferState("idle");
    }}
  />
</Show>
```

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/index.tsx
git commit -m "feat(receive): Add incoming nearby request handling"
```

---

## Chunk 8: Integration & Testing

**Files:**
- Modify: Various as needed based on testing

- [ ] **Step 1: Run full build**

Run: `cd app && pnpm run tauri build`
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: Test locally**

Manual testing checklist:
- [ ] Nearby tab appears in bottom dock
- [ ] Device discovery starts when visiting Nearby tab
- [ ] Nearby devices appear after a few seconds
- [ ] Can select files via drop or tap
- [ ] Can tap a device to initiate transfer
- [ ] Sender sees waiting state
- [ ] Receiver sees incoming request card
- [ ] Receiver can accept/decline
- [ ] Progress updates during transfer
- [ ] Transfer completes successfully
- [ ] Cancel works on both sides
- [ ] Error states display correctly

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Implement AirDrop-like nearby discovery experience"
```

---

## Summary

| Chunk | Description | Files |
|-------|-------------|-------|
| 1 | Rust backend - mDNS discovery | `lib/src/nearby.rs`, `lib/src/lib.rs`, `lib/Cargo.toml` |
| 2 | Tauri commands | `app/src-tauri/src/lib.rs` |
| 3 | TypeScript bindings | `app/src/bindings.ts` |
| 4 | Store extensions | `app/src/lib/store.tsx` |
| 5 | UI components | 6 new component files |
| 6 | Nearby tab route | `app/src/routes/nearby.tsx`, modify `index.tsx` |
| 7 | Receive tab integration | `app/src/routes/index.tsx` |
| 8 | Integration & testing | Full build verification |
