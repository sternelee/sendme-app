# WebSocket Implementation Analysis for sendme-app

## Executive Summary

The sendme-app uses **direct `tokio-tungstenite` WebSocket implementation** (NOT tauri-plugin-websocket). The current setup is already functional and well-integrated with the Tauri app lifecycle and auth system.

---

## 1. Dependency Status: `tauri-plugin-websocket`

### ❌ NOT INSTALLED

**Cargo.toml** (`/Users/sternelee/www/github/sendme-app/app/src-tauri/Cargo.toml`):
- **tokio-tungstenite IS a dependency** (line 22)
  ```toml
  tokio-tungstenite = { version = "0.26", default-features = false, features = ["connect", "rustls-tls-webpki-roots"] }
  ```
- `tauri-plugin-websocket` is **NOT listed** anywhere in the file

**package.json** (`/Users/sternelee/www/github/sendme-app/app/package.json`):
- No `@tauri-apps/plugin-websocket` or equivalent found

---

## 2. Current WebSocket Implementation (tokio-tungstenite)

### Import Statement
**File:** `app/src-tauri/src/lib.rs` (line 19)
```rust
use tokio_tungstenite::{connect_async, tungstenite::Message};
```

### Core WebSocket Loop: `run_cloud_presence_loop`
**File:** `app/src-tauri/src/lib.rs` (lines 2048-2222)

#### Function Signature
```rust
async fn run_cloud_presence_loop(
    app: AppHandle,
    cloud: CloudPresenceState,
    generation: u64,
    request: StartCloudPresenceRequest,
    mut shutdown_rx: oneshot::Receiver<()>,
)
```

#### Key Implementation Details

**1. Connection (lines 2131-2189):**
```rust
match connect_async(ws_url.as_str()).await {
    Ok((stream, _)) => {
        reconnect_attempt = 0;
        update_cloud_connection_state(&app, &cloud, generation, true, None).await;

        let (mut writer, mut reader) = stream.split();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break 'outer;
                }
                _ = heartbeat.tick() => {
                    if let Err(error) = writer.send(Message::Text("{\"type\":\"heartbeat\"}".into())).await {
                        // Error handling...
                        break;
                    }
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(message)) => {
                            if let Err(error) = handle_cloud_server_message(&app, &cloud, generation, message).await {
                                break;
                            }
                        }
                        Some(Err(error)) => {
                            // Error handling...
                            break;
                        }
                        None => {
                            // Connection closed...
                            break;
                        }
                    }
                }
            }
        }
    }
    Err(error) => {
        // Connection failed, update state...
    }
}
```

**2. Message Handling (`handle_cloud_server_message`, lines 2004-2046):**
```rust
async fn handle_cloud_server_message(
    app: &AppHandle,
    cloud: &CloudPresenceState,
    generation: u64,
    message: Message,
) -> Result<(), String> {
    let payload = match message {
        Message::Text(text) => text.to_string(),
        Message::Binary(bytes) => String::from_utf8(bytes.to_vec())?,
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => return Ok(()),
        Message::Close(frame) => {
            // Handle close frame
            return Err(reason);
        }
    };

    let message: CloudServerMessage = serde_json::from_str(&payload)?;

    match message {
        CloudServerMessage::Friends(friends) => update_cloud_friends(app, cloud, generation, friends).await,
        CloudServerMessage::Devices(devices) => update_cloud_devices(app, cloud, generation, devices).await,
        CloudServerMessage::Tickets(tickets) => update_cloud_tickets(app, cloud, generation, tickets).await,
        CloudServerMessage::Error(message) => update_cloud_server_error(app, cloud, generation, message).await,
        CloudServerMessage::Pong => {},
        CloudServerMessage::TransferReceived(payload) => {
            let _ = app.emit("cloud_transfer_received", payload);
        }
    }

    Ok(())
}
```

**3. Reconnection Logic (lines 2204-2209):**
```rust
let delay_ms = (1_000u64 * (1u64 << reconnect_attempt.min(5))).min(30_000);
reconnect_attempt = reconnect_attempt.saturating_add(1);
if wait_for_shutdown_or_timeout(&mut shutdown_rx, Duration::from_millis(delay_ms)).await {
    break;
}
```
- Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s (max 30s)

**4. Authorization & Setup (lines 2074-2129):**
- Retrieves auth token via `current_cloud_authorization_header(&app)` (better-auth session)
- Registers device via REST API call to `/api/devices`
- Builds WebSocket URL with token
- Implements 60-second device registration cache (lines 1957-2002)

---

## 3. Frontend: How WebSocket is Started

### Auth Context
**File:** `app/src/lib/auth.tsx` (lines 1-403)

#### Key Auth State:
- `isSignedIn()` — Signal indicating user is logged in (line 37)
- `isLoaded()` — Signal indicating auth is ready (line 36)
- Cached user in localStorage (`sendme_cached_user`, line 47)
- Events from Rust plugin update auth state (lines 240-276)

#### Auth Flow:
1. **Cached user loaded on mount** (lines 168-171)
2. **better-auth session initialized after deep-link callback** (lines 210-235)
3. **Rust auth events listened** (lines 237-297)
4. **User state updated** via `setUser()` (lines 175-179)

### PresenceConnector Component
**File:** `app/src/app.tsx` (lines 10-33)

```typescript
function PresenceConnector() {
  const auth = useAuth();

  createEffect(() => {
    if (!auth.isLoaded()) {
      return;
    }

    if (auth.isSignedIn()) {
      start_cloud_presence({
        deviceId: getPersistentDeviceId(),
        apiOrigin: getCloudApiOrigin(),
      }).catch((e) =>
        console.error("[PresenceConnector] backend presence start failed:", e),
      );
    } else {
      stop_cloud_presence().catch((e) =>
        console.error("[PresenceConnector] backend presence stop failed:", e),
      );
    }
  });

  return null;
}
```

#### Conditions for WebSocket Start:
1. `auth.isLoaded()` must be true
2. `auth.isSignedIn()` must be true
3. Called reactively whenever auth state changes (lines 13-30)

### Start/Stop Commands
**File:** `app/src/bindings.ts` (lines 256-264)

```typescript
export async function start_cloud_presence(
  request: StartCloudPresenceRequest,
): Promise<CloudPresenceState> {
  return await invoke("start_cloud_presence", { request });
}

export async function stop_cloud_presence(): Promise<void> {
  return await invoke("stop_cloud_presence");
}
```

---

## 4. Tauri Command Registration

**File:** `app/src-tauri/src/lib.rs` (lines 3372-3373)

```rust
.invoke_handler(tauri::generate_handler![
    // ... other commands ...
    start_cloud_presence,
    stop_cloud_presence,
    get_cloud_presence_state,
    // ... other commands ...
])
```

---

## 5. Cloud Presence State Management

**File:** `app/src-tauri/src/lib.rs` (lines 605-637)

```rust
#[derive(Debug, Clone)]
pub struct CloudPresenceState {
    generation: u64,
    api_origin: Option<String>,
    snapshot: CloudPresenceSnapshotPayload,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl CloudPresenceState {
    fn new() -> Self {
        Self {
            generation: 0,
            api_origin: None,
            snapshot: CloudPresenceSnapshotPayload::default(),
            shutdown_tx: None,
        }
    }
}
```

### Why "generation"?
- Allows tracking which instance should be active when user quickly toggles auth on/off
- New `start_cloud_presence` call increments generation
- Old loop instances check if their generation matches before updating state
- Prevents race conditions with rapid connect/disconnect cycles

---

## 6. Heartbeat & Health Check

**Location:** `app/src-tauri/src/lib.rs` (lines 2137-2156)

- **Interval:** 30 seconds
- **Type:** Text message: `{"type":"heartbeat"}`
- **Response expectation:** Server responds with `Pong` message type
- **Missed ticks:** Set to `Delay` behavior (catches up rather than skipping)
- **Failure handling:** If heartbeat fails to send, connection loop breaks and reconnection is attempted

---

## 7. Server Message Types

**Location:** `app/src-tauri/src/lib.rs` (lines 2004-2046)

Handled message types:
- `CloudServerMessage::Friends(friends)` — Updates friend list
- `CloudServerMessage::Devices(devices)` — Updates device list
- `CloudServerMessage::Tickets(tickets)` — Updates transfer tickets
- `CloudServerMessage::Error(message)` — Server error notification
- `CloudServerMessage::Pong` — Heartbeat response
- `CloudServerMessage::TransferReceived(payload)` — Emits to frontend
- Control frames: `Ping`, `Pong`, `Close` — Handled gracefully

---

## 8. Error States & Recovery

**Location:** `app/src-tauri/src/lib.rs` (lines 2074-2209)

### Failure Points & Handling:

| Failure | Location | Recovery |
|---------|----------|----------|
| Client initialization fails | Line 2055-2067 | Update state, retry with 3s timeout |
| No auth token available | Line 2075-2084 | Retry loop with 3s timeout |
| Device registration fails | Line 2104-2119 | Retry loop with 3s timeout |
| WebSocket connection fails | Line 2190-2202 | Exponential backoff (1s-30s) |
| Heartbeat send fails | Line 2145-2155 | Break inner loop, attempt reconnect |
| Message receive fails | Line 2165-2173 | Break inner loop, attempt reconnect |
| WebSocket closes normally | Line 2175-2184 | Break inner loop, attempt reconnect |

### Exponential Backoff:
```
Attempt 0: 1 second
Attempt 1: 2 seconds
Attempt 2: 4 seconds
Attempt 3: 8 seconds
Attempt 4: 16 seconds
Attempt 5+: 32 seconds (capped at 30s)
```

---

## 9. Auth Token Management

**Location:** `app/src-tauri/src/lib.rs`

### Token Retrieval:
```rust
let authorization = match current_cloud_authorization_header(&app) {
    Ok(value) => value,
    Err(error) => {
        update_cloud_connection_state(&app, &cloud, generation, false, Some(error)).await;
        // Retry logic...
    }
};

let token = match extract_bearer_token(&authorization) {
    Some(token) => token.to_string(),
    None => {
        // Error: authorization exists but no Bearer token...
    }
};
```

- **Source:** `app/src/lib/auth.ts` — better-auth browser callback + deep link
- **Format:** HTTP Authorization header with Bearer token
- **Usage:** Included in WebSocket URL and REST API calls
- **Refresh:** Retrieved fresh on each reconnection attempt

---

## 10. Device Registration (REST API, Pre-WebSocket)

**Location:** `app/src-tauri/src/lib.rs` (lines 1957-2002)

```rust
async fn ensure_cloud_device_registered(
    app: &AppHandle,
    client: &Client,
    request: &StartCloudPresenceRequest,
    token: &str,
    registered_key: &mut Option<String>,
    registered_at: &mut Option<Instant>,
) -> Result<(), String>
```

### POST `/api/devices` Payload:
```json
{
  "deviceId": "persistent-device-uuid",
  "name": "device-name-from-profile",
  "hostname": "device-name-from-profile"
}
```

### Cache Logic:
- Caches registration for 60 seconds
- Registration key: `"{token}:{device_id}"`
- Re-registers if token changes or cache expires
- Runs **before** WebSocket connection attempt

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **WebSocket Library** | `tokio-tungstenite` v0.26 |
| **Plugin Used** | None (direct tungstenite) |
| **Auth Method** | better-auth (browser OAuth + deep link) |
| **Connection Trigger** | `auth.isSignedIn() && auth.isLoaded()` |
| **Heartbeat** | 30s interval, `{"type":"heartbeat"}` |
| **Reconnect Strategy** | Exponential backoff (1s-30s) |
| **Generation System** | Prevents race conditions on rapid auth toggles |
| **Message Types** | Friends, Devices, Tickets, Error, Pong, TransferReceived |
| **Frontend Hook** | `PresenceConnector` in `app.tsx` |
| **Shutdown** | Graceful via `oneshot::Receiver<()>` |

