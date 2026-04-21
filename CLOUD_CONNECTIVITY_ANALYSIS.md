# Sendme App Cloud Connectivity Layer - Complete Analysis

## 1. Cloud API Client (`cloud-api.ts`)

### Overview
The cloud API client is a lightweight wrapper around HTTP/WebSocket connectivity to the Sendme cloud backend at `https://sendme.leeapp.dev`.

### Configuration
- **Default Cloud Origin**: `https://sendme.leeapp.dev`
- **Configurable via**: `VITE_BROWSER_API_ORIGIN` environment variable
- **API Base URL**: `{ORIGIN}/api`

### Core Functions

#### URL Building
```typescript
getCloudApiOrigin(): string
getCloudApiBaseUrl(): string // returns "{origin}/api"
getCloudApiUrl(path: string): string
getCloudWebSocketUrl(path: string = "/api/ws"): string
```

#### Authentication
```typescript
getAuthorizationHeaderValue(): Promise<string | null>
// Invokes Tauri Clerk plugin: "plugin:clerk|get_client_authorization_header"
// Returns the full header string (e.g., "Bearer <JWT_TOKEN>")

extractBearerToken(authorizationHeader: string | null): string | null
// Parses "Bearer <token>" format, returns just the token

getAuthorizationHeaders(): Promise<HeadersInit>
// Returns { Authorization: "<full header>" } or {}
```

#### Device Management
```typescript
getPersistentDeviceId(): string
// Generates UUID once and stores in localStorage["sendme_device_id"]
// This ID persists across app restarts
// Used to identify the device in cloud and WebSocket connections
```

### Authentication Flow
1. Clerk plugin provides JWT token via Tauri IPC: `plugin:clerk|get_client_authorization_header`
2. Token extracted and used in `Authorization: Bearer <JWT>` header for all API calls
3. WebSocket connection includes token as query parameter: `?token=<JWT>`
4. Clerk JWT authenticates user identity to cloud backend

---

## 2. Friends System (`friends.ts`)

### Overview
The friends system manages friend relationships, friend requests, and ticket sharing between friends.

### Data Types

```typescript
interface FriendDevice {
  id: string
  name: string
  platform: string
  online: boolean
  lastSeenAt: Date
}

interface Friend {
  id: string
  userId: string
  friendUserId: string
  status: "pending" | "accepted"
  createdAt: Date
  updatedAt: Date
  acceptedAt: Date | null
  friend: {
    id: string
    name: string
    email: string
    image: string | null
  }
  friendDevices: FriendDevice[]
}
```

### API Endpoints

#### 1. Get Friends List
```typescript
getFriends(status: "accepted" | "pending" | "all" = "accepted"): Promise<Friend[]>

// HTTP: GET {API_BASE}/friends?status={status}
// Headers: Authorization, Content-Type: application/json
```

#### 2. Add Friend / Accept Friend Request
```typescript
addFriend(email: string): Promise<{ success: boolean; action?: string; error?: string }>

// HTTP: POST {API_BASE}/friends
// Headers: Authorization, Content-Type: application/json
// Body: { email: string }

// Response action values:
// - "accepted": Direct friend (both users already exist)
// - "sent": Friend request sent (awaiting acceptance)
// - Other values indicate pending state
```

#### 3. Remove Friend / Decline Request
```typescript
removeFriend(friendUserId: string): Promise<void>

// HTTP: DELETE {API_BASE}/friends/{friendUserId}
// Headers: Authorization, Content-Type: application/json
```

#### 4. Send Ticket to Friend
```typescript
sendTicketToFriend(
  friendUserId: string,
  ticket: string,
  filename?: string,
): Promise<{ success: boolean }>

// HTTP: POST {API_BASE}/tickets
// Headers: 
//   - Authorization
//   - Content-Type: application/json
//   - X-Device-Id: {persistent device ID}
// Body: {
//   friendUserId: string
//   ticket: string
//   filename?: string
// }
```

#### 5. Send Ticket to Own Device
```typescript
sendTicketToDevice(
  deviceId: string,
  ticket: string,
  filename?: string,
): Promise<{ success: boolean }>

// HTTP: POST {API_BASE}/tickets
// Headers: 
//   - Authorization
//   - Content-Type: application/json
//   - X-Device-Id: {persistent device ID}
// Body: {
//   deviceId: string
//   ticket: string
//   filename?: string
// }
```

#### 6. Get Shared Tickets (Incoming)
```typescript
getSharedTickets(): Promise<Array<{
  id: string
  ticket: string
  filename: string | null
  senderName: string
  createdAt: Date
}>>

// HTTP: GET {API_BASE}/tickets?deviceId={encoded device ID}
// Headers: 
//   - Authorization
//   - Content-Type: application/json
//   - X-Device-Id: {persistent device ID}
```

#### 7. Mark Ticket Received
```typescript
markTicketReceived(ticketId: string): Promise<void>

// HTTP: POST {API_BASE}/tickets/{ticketId}/receive
// Headers: 
//   - Authorization
//   - Content-Type: application/json
//   - X-Device-Id: {persistent device ID}
```

### Service Pattern
- Uses singleton pattern: `useFriends()` returns shared instance
- All methods handle errors with console.error logging
- Errors are re-thrown for caller handling

---

## 3. Cloud WebSocket Connection (`cloud-ws.ts`)

### Overview
The WebSocket layer maintains a persistent connection to the cloud backend for real-time presence updates (friends online status, incoming tickets, device availability).

### Connection Lifecycle

#### Connect
```typescript
connectCloudWebSocket(): Promise<void>
```

**Steps:**
1. Get Clerk JWT from plugin
2. Extract bearer token
3. Register device: `invoke("register_cloud_device", { deviceId, apiOrigin })`
4. Build WebSocket URL: `wss://sendme.leeapp.dev/api/ws?deviceId={id}&token={jwt}`
5. Connect using `@tauri-apps/plugin-websocket`
6. Add listener for incoming messages
7. Start heartbeat timer (every 30 seconds)

#### Disconnect
```typescript
disconnectCloudWebSocket(): Promise<void>
```

**Steps:**
1. Stop reconnect attempts
2. Close WebSocket connection
3. Invoke `stop_cloud_presence` Tauri command

### Connection State Management
```typescript
let ws: WebSocket | null = null
let heartbeatTimer: NodeJS.Timer | null = null
let reconnectTimer: NodeJS.Timer | null = null
let reconnectAttempt = 0
let isConnecting = boolean
let shouldBeConnected = boolean // User's desired state
```

### Reconnection Strategy
- **Exponential backoff**: `Math.min(1000 * Math.pow(2, attempt), 30000)` ms
- **Max delay**: 30 seconds
- **Attempt counter**: Resets on successful connection
- **Automatic reconnect**: Only if `shouldBeConnected = true`

### Message Handling
```typescript
async function handleMessage(message: { type: string; data: string | number[] })
```

**Message Types:**
- `"Close"`: WebSocket closed by server → schedules reconnect
- `"Text"`: JSON message → parsed and sent to `update_cloud_state` Tauri command

### Heartbeat
```typescript
// Sent every 30 seconds via: ws.send(JSON.stringify({ type: "heartbeat" }))
```

### Connection State Updates
All state changes invoke:
```typescript
await invoke("set_cloud_connected", {
  connected: boolean,
  deviceId: string,
  apiOrigin: string,
  error?: string
})
```

---

## 4. Tauri Backend Cloud Module (`src-tauri/src/lib.rs`)

### Device Registration

```rust
#[tauri::command]
async fn register_cloud_device(
    app: AppHandle,
    device_id: String,
    api_origin: String,
) -> Result<(), String>
```

**Request:**
```http
POST {api_origin}/api/devices
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "deviceId": "{device_id}",
  "name": "{device_name from nearby profile}",
  "hostname": "{device_name from nearby profile}"
}
```

**User Agent Header**: Platform-specific
- Android: "Sendme Android"
- iOS: "Sendme iPhone"
- macOS: "Sendme macOS"
- Windows: "Sendme Windows"
- Linux: "Sendme Linux"

### Cloud Presence State

```rust
type CloudPresenceState = Arc<RwLock<CloudPresenceRuntime>>

struct CloudPresenceRuntime {
    generation: u64              // For staleness checking
    api_origin: Option<String>   // Cloud origin URL
    snapshot: CloudPresenceSnapshotPayload
}

struct CloudPresenceSnapshotPayload {
    active: bool
    connected: bool
    device_id: Option<String>
    last_error: Option<String>
    friends: Vec<CloudFriendPayload>
    devices: Vec<CloudDevicePayload>
    tickets: Vec<CloudTicketPayload>
}
```

### CloudServerMessage Protocol

Deserialized from WebSocket messages:
```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum CloudServerMessage {
    Friends(Vec<CloudFriendPayload>),    // Friends list + devices
    Devices(Vec<CloudDevicePayload>),    // Your other devices
    Tickets(Vec<CloudTicketPayload>),    // Incoming tickets
    Error(String),                        // Server error message
    Pong,                                 // Heartbeat response
    TransferReceived(CloudTransferReceivedPayload),  // Confirmation
}
```

### Cloud Device Payload

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CloudDevicePayload {
    id: String
    device_id: Option<String>
    name: String
    platform: String
    online: bool
    last_seen_at: Option<String>
}
```

### Cloud Friend Payload

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CloudFriendPayload {
    id: String
    user_id: String
    friend_user_id: String
    status: String                           // "pending" or "accepted"
    created_at: String
    updated_at: String
    accepted_at: Option<String>
    friend: CloudFriendUserPayload {
        id: String
        name: String
        email: String
        image: Option<String>
    }
    friend_devices: Vec<CloudFriendDevicePayload> {
        id: String
        name: String
        platform: String
        online: bool
        last_seen_at: String
    }
}
```

### Cloud Ticket Payload

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CloudTicketPayload {
    id: String
    ticket: String                   // The actual transfer ticket
    filename: Option<String>
    file_size: Option<u64>
    sender_name: Option<String>
    created_at: Option<String>
    status: Option<String>           // "pending" or other states
}
```

### Tauri Commands

#### 1. Set Connection State
```rust
#[tauri::command]
async fn set_cloud_connected(
    app: AppHandle,
    cloud: tauri::State<CloudPresenceState>,
    connected: bool,
    device_id: Option<String>,
    api_origin: Option<String>,
    error: Option<String>,
) -> Result<(), String>
```
- Updates internal state
- Emits `cloud_presence_state` event

#### 2. Update Cloud State (from WebSocket)
```rust
#[tauri::command]
async fn update_cloud_state(
    app: AppHandle,
    cloud: tauri::State<CloudPresenceState>,
    message_json: String,
) -> Result<(), String>
```
- Parses JSON message
- Routes to appropriate handler:
  - `Friends` → `update_cloud_friends()`
  - `Devices` → `update_cloud_devices()`
  - `Tickets` → `update_cloud_tickets()`
  - `Error` → `update_cloud_server_error()`
  - `Pong` → no-op
  - `TransferReceived` → emits `cloud_transfer_received` event

#### 3. Get Presence State
```rust
#[tauri::command]
async fn get_cloud_presence_state(
    cloud: tauri::State<CloudPresenceState>,
) -> Result<CloudPresenceSnapshotPayload, String>
```
- Returns current snapshot immediately

#### 4. Stop Cloud Presence
```rust
#[tauri::command]
async fn stop_cloud_presence(
    app: AppHandle,
    cloud: tauri::State<CloudPresenceState>,
) -> Result<(), String>
```
- Clears all state
- Emits empty updates

#### 5. Accept Cloud Ticket
```rust
#[tauri::command]
async fn accept_cloud_ticket(
    app: AppHandle,
    cloud: tauri::State<CloudPresenceState>,
    transfers: tauri::State<Transfers>,
    ticket_id: String,
    output_dir: Option<String>,
) -> Result<String, String>
```
- Looks up ticket in snapshot
- Calls `receive_file()` to start download
- **Async**: Marks ticket received on server (best-effort POST to `/api/tickets/{id}/receive`)

#### 6. Decline Cloud Ticket
```rust
#[tauri::command]
async fn decline_cloud_ticket(
    app: AppHandle,
    cloud: tauri::State<CloudPresenceState>,
    ticket_id: String,
) -> Result<(), String>
```
- Removes ticket from snapshot
- Emits updated state

### Event Emissions

The backend emits these Tauri events when state changes:

```rust
app.emit("cloud_presence_state", CloudPresenceSnapshotPayload)
app.emit("cloud_friends_updated", Vec<CloudFriendPayload>)
app.emit("cloud_devices_updated", Vec<CloudDevicePayload>)
app.emit("cloud_tickets_updated", Vec<CloudTicketPayload>)
app.emit("cloud_presence_error", String)
app.emit("cloud_transfer_received", CloudTransferReceivedPayload)
```

### Android Foreground Service

On Android, the backend maintains a foreground service notification:

```rust
#[cfg(target_os = "android")]
struct AndroidForegroundNotificationPayload {
    title: String
    message: String
    detail: String
    progress_current: u32
    progress_total: u32
    indeterminate: bool
}
```

Notification shows:
- Connected status + pending tickets count
- Friend update counts
- Error messages
- Transfer progress if active

---

## 5. Frontend Integration

### Main App (`app.tsx`)
```typescript
function PresenceConnector() {
  const auth = useAuth()
  
  createEffect(() => {
    if (!auth.isLoaded()) return
    
    if (auth.isSignedIn()) {
      connectCloudWebSocket() // Auto-connect when signed in
    } else {
      disconnectCloudWebSocket() // Auto-disconnect when signed out
    }
  })
  
  onCleanup(() => {
    disconnectCloudWebSocket() // Cleanup on app unload
  })
}
```

### Friends Page (`friends.tsx`)
- **Load friends**: `friendsService.getFriends("accepted" | "pending" | "all")`
- **Add friend**: `friendsService.addFriend(email)`
- **Accept request**: `friendsService.addFriend(email)` (idempotent)
- **Decline request**: `friendsService.removeFriend(friendUserId)`
- **Send to friend**: `friendsService.sendTicketToFriend(friendUserId, ticket, filename)`
- **Listen for updates**: `listen("cloud_friends_updated", handler)`

### Devices Page (`devices.tsx`)
- **Load devices**: `get_cloud_presence_state()` → `snapshot.devices`
- **Send to device**: `friendsService.sendTicketToDevice(deviceId, ticket, filename)`
- **Listen for updates**: `listen("cloud_devices_updated", handler)`

### State Management
- **Snapshot querying**: `await get_cloud_presence_state()` returns latest server-synced state
- **Real-time updates**: Listen for `cloud_*_updated` events for live changes
- **Error handling**: Listen for `cloud_presence_error` for connection issues

---

## 6. WebSocket Message Protocol

### Client → Server

```json
{
  "type": "heartbeat"
}
```

### Server → Client

**Friends Update:**
```json
{
  "type": "friends",
  "data": [
    {
      "id": "friendship_id",
      "userId": "your_user_id",
      "friendUserId": "friend_user_id",
      "status": "accepted",
      "createdAt": "2026-04-20T00:00:00Z",
      "updatedAt": "2026-04-20T00:00:00Z",
      "acceptedAt": "2026-04-20T00:00:00Z",
      "friend": {
        "id": "friend_id",
        "name": "Friend Name",
        "email": "friend@example.com",
        "image": "https://..."
      },
      "friendDevices": [
        {
          "id": "device_id",
          "name": "iPhone 15",
          "platform": "ios",
          "online": true,
          "lastSeenAt": "2026-04-20T12:00:00Z"
        }
      ]
    }
  ]
}
```

**Devices Update:**
```json
{
  "type": "devices",
  "data": [
    {
      "id": "device_id",
      "deviceId": "persistent_device_uuid",
      "name": "MacBook Pro",
      "platform": "macos",
      "online": true,
      "lastSeenAt": "2026-04-20T12:00:00Z"
    }
  ]
}
```

**Tickets Update:**
```json
{
  "type": "tickets",
  "data": [
    {
      "id": "ticket_id",
      "ticket": "base64_encoded_ticket_data",
      "filename": "document.pdf",
      "fileSize": 1024000,
      "senderName": "Friend Name",
      "createdAt": "2026-04-20T12:00:00Z",
      "status": "pending"
    }
  ]
}
```

**Error:**
```json
{
  "type": "error",
  "data": "Error message from server"
}
```

**Pong (Heartbeat Response):**
```json
{
  "type": "pong"
}
```

**Transfer Received (Confirmation):**
```json
{
  "type": "transfer_received",
  "data": {
    "ticketId": "ticket_id",
    "filename": "document.pdf",
    "fileSize": 1024000
  }
}
```

---

## 7. Authentication Details

### JWT Token Source
- **Provider**: Clerk (managed via `tauri-plugin-clerk`)
- **Obtained via**: Tauri IPC call to `plugin:clerk|get_client_authorization_header`
- **Format**: `"Bearer <JWT>"`
- **Scopes**: Manages user identity and device registration

### Token Lifecycle
1. **On sign-in**: Clerk provides JWT
2. **On WebSocket connect**: Extracted and sent as query param + header
3. **On device register**: Sent in Authorization header
4. **On API calls**: Sent in Authorization header
5. **On sign-out**: Connection drops, token becomes invalid

### Token Refresh
- Handled by Clerk plugin automatically
- WebSocket reconnect uses latest token
- No explicit refresh mechanism in cloud-ws.ts

---

## 8. Key Design Patterns

### 1. Persistent Device ID
- Generated once, stored in browser localStorage
- Survives app restarts
- Used to correlate devices across cloud

### 2. Generation Counter
- Each cloud state has a `generation` number
- Used to ignore stale messages during reconnects
- Incremented on major state changes

### 3. Singleton Service Pattern
```typescript
let friendsServiceInstance: FriendsService | null = null
export function useFriends(): FriendsService {
  if (!friendsServiceInstance) {
    friendsServiceInstance = new FriendsService()
  }
  return friendsServiceInstance
}
```

### 4. Real-time + HTTP Hybrid
- **WebSocket**: Real-time presence (friends online, incoming tickets)
- **HTTP**: Stateless operations (add friend, send ticket)
- **Fallback**: HTTP polling via `get_cloud_presence_state()` if WebSocket unavailable

### 5. Best-Effort Ticket Marking
```rust
// Non-blocking async task after ticket accepted
tokio::spawn(async move {
  if let Some(auth) = authorization {
    let _ = client.post(&mark_url)...send().await
  }
})
```
- Doesn't block user from receiving file
- Server-side cleanup happens eventually

---

## 9. Error Handling & Edge Cases

### WebSocket Reconnection
- Automatic exponential backoff on failure
- Manual disconnect clears reconnect timer
- Sign-out immediately disconnects

### Missing Auth
- `getAuthorizationHeaderValue()` catches Clerk plugin errors
- Returns `null` on failure
- WebSocket refuses to connect without token

### Device Registration Failure
- Blocks WebSocket connection
- Schedules retry with exponential backoff

### Stale Message Handling
- Generation counter prevents processing old messages
- Useful during rapid reconnects

### Network Failures
- Heartbeat failure triggers reconnect
- Server close (type: "Close") triggers reconnect
- All errors logged to console

---

## 10. API Surface Summary

### Cloud API (`cloud-api.ts`)
- `getCloudApiOrigin()`
- `getCloudApiBaseUrl()`
- `getCloudApiUrl(path)`
- `getCloudWebSocketUrl(path)`
- `getPersistentDeviceId()`
- `getAuthorizationHeaderValue()`
- `extractBearerToken()`
- `getAuthorizationHeaders()`

### Friends Service (`friends.ts`)
- `getFriends(status?)`
- `addFriend(email)`
- `removeFriend(friendUserId)`
- `sendTicketToFriend(friendUserId, ticket, filename?)`
- `sendTicketToDevice(deviceId, ticket, filename?)`
- `getSharedTickets()`
- `markTicketReceived(ticketId)`
- `useFriends()` (singleton factory)

### Cloud WebSocket (`cloud-ws.ts`)
- `connectCloudWebSocket()`
- `disconnectCloudWebSocket()`

### Tauri Commands (Backend)
- `register_cloud_device(device_id, api_origin)`
- `set_cloud_connected(connected, device_id?, api_origin?, error?)`
- `update_cloud_state(message_json)`
- `get_cloud_presence_state()`
- `stop_cloud_presence()`
- `accept_cloud_ticket(ticket_id, output_dir?)`
- `decline_cloud_ticket(ticket_id)`

### Tauri Events (Backend → Frontend)
- `cloud_presence_state`
- `cloud_friends_updated`
- `cloud_devices_updated`
- `cloud_tickets_updated`
- `cloud_presence_error`
- `cloud_transfer_received`

