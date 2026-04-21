# Cloud API Contract Reference

**Generated:** April 20, 2026  
**Scope:** Complete request/response specifications for cloud API endpoints

---

## Authentication Headers

### Bearer Token Format
```
Authorization: Bearer eyJhbGc...JWT...
```

### Clerk JWT Claims (typical)
```json
{
  "aud": "https://sendme.leeapp.dev",
  "sub": "user_123456",
  "email": "user@example.com",
  "email_verified": true,
  "iat": 1713607200,
  "exp": 1713610800,
  "azp": "sendme_clerk_app"
}
```

### Query Parameter Fallback (WebSocket)
```
GET https://api.../api/ws?token=eyJhbGc...&deviceId=550e8400-e29b-41d4-a716-446655440000
```

---

## HTTP Endpoints

### 1. Device Registration

#### `POST /api/devices`

**Purpose:** Register or update a device for the authenticated user.

**Request:**
```http
POST /api/devices HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My MacBook Pro",
  "hostname": "my-macbook-pro.local"
}
```

**Response (200 OK):**
```json
{
  "id": "device_123456",
  "userId": "user_123456",
  "persistentId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My MacBook Pro",
  "platform": "macos",
  "online": true,
  "lastSeenAt": "2026-04-20T18:30:00Z",
  "createdAt": "2026-04-15T10:00:00Z",
  "updatedAt": "2026-04-20T18:30:00Z"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Missing deviceId"
}
```

**Response (401 Unauthorized):**
```
Unauthorized
```

**Implementation:**
- **Tauri:** `app/src-tauri/src/lib.rs:1920` (`ensure_device_registered`)
- **Browser:** `browser/src/lib/composables/deviceRegistration.ts:39`
- **Server:** `browser/src/routes/api/devices/index.ts:4`

---

### 2. Get Devices

#### `GET /api/devices`

**Purpose:** List all devices for the authenticated user.

**Request:**
```http
GET /api/devices HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```json
[
  {
    "id": "device_123456",
    "userId": "user_123456",
    "persistentId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My MacBook Pro",
    "platform": "macos",
    "online": true,
    "lastSeenAt": "2026-04-20T18:30:00Z"
  },
  {
    "id": "device_789012",
    "userId": "user_123456",
    "persistentId": "660f9511-f40c-52e5-b827-557766551111",
    "name": "iPhone",
    "platform": "ios",
    "online": false,
    "lastSeenAt": "2026-04-19T14:20:00Z"
  }
]
```

---

### 3. Update Device Heartbeat

#### `PUT /api/devices/{deviceId}/heartbeat`

**Purpose:** Update the last seen timestamp for a device (keep-alive).

**Request:**
```http
PUT /api/devices/device_123456/heartbeat HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```json
{
  "lastSeenAt": "2026-04-20T18:35:00Z"
}
```

---

### 4. Delete Device

#### `DELETE /api/devices/{deviceId}`

**Purpose:** Unregister a device.

**Request:**
```http
DELETE /api/devices/device_123456 HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
```

**Response (204 No Content):**
```
(empty body)
```

---

### 5. Get Friends

#### `GET /api/friends?status=accepted`

**Purpose:** List friends with optional status filter.

**Request:**
```http
GET /api/friends?status=accepted HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
```

**Query Parameters:**
- `status` (optional): `"pending"`, `"accepted"`, or `"all"` (default: `"accepted"`)

**Response (200 OK):**
```json
[
  {
    "id": "friend_rel_123",
    "userId": "user_123456",
    "friendUserId": "user_999999",
    "status": "accepted",
    "createdAt": "2026-03-15T08:00:00Z",
    "updatedAt": "2026-03-16T10:00:00Z",
    "acceptedAt": "2026-03-16T10:00:00Z",
    "friend": {
      "id": "user_999999",
      "name": "John Doe",
      "email": "john@example.com",
      "image": "https://avatar.example.com/john.jpg"
    },
    "friendDevices": [
      {
        "id": "device_456789",
        "name": "John's iPhone",
        "platform": "ios",
        "online": true,
        "lastSeenAt": "2026-04-20T17:45:00Z"
      }
    ]
  }
]
```

---

### 6. Add Friend

#### `POST /api/friends`

**Purpose:** Send a friend request or accept a pending request.

**Request:**
```http
POST /api/friends HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "email": "john@example.com"
}
```

**Response (200 OK) - New Request:**
```json
{
  "action": "request_sent",
  "id": "friend_rel_123",
  "status": "pending"
}
```

**Response (200 OK) - Accepted Existing Request:**
```json
{
  "action": "request_accepted",
  "id": "friend_rel_123",
  "status": "accepted",
  "acceptedAt": "2026-04-20T18:45:00Z"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "User not found"
}
```

---

### 7. Remove Friend

#### `DELETE /api/friends/{friendUserId}`

**Purpose:** Remove a friend or decline a friend request.

**Request:**
```http
DELETE /api/friends/user_999999 HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
```

**Response (204 No Content):**
```
(empty body)
```

---

### 8. Get Tickets

#### `GET /api/tickets?deviceId={deviceId}`

**Purpose:** Get received tickets for a device.

**Request:**
```http
GET /api/tickets?deviceId=550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
X-Device-Id: 550e8400-e29b-41d4-a716-446655440000
```

**Query Parameters:**
- `deviceId` (required): The persistent client-side device ID

**Headers:**
- `X-Device-Id` (optional): Alternative to query param

**Response (200 OK):**
```json
[
  {
    "id": "ticket_abc123",
    "userId": "user_123456",
    "deviceId": "550e8400-e29b-41d4-a716-446655440000",
    "senderUserId": "user_999999",
    "senderName": "John Doe",
    "ticket": "iroh:aabbccdd...",
    "filename": "document.pdf",
    "fileSize": 2048576,
    "received": false,
    "createdAt": "2026-04-20T15:00:00Z"
  }
]
```

---

### 9. Send Ticket

#### `POST /api/tickets`

**Purpose:** Share a ticket with a friend (send a transfer).

**Request:**
```http
POST /api/tickets HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
X-Device-Id: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "friendUserId": "user_999999",
  "ticket": "iroh:aabbccdd...",
  "filename": "document.pdf",
  "fileSize": 2048576
}
```

**Headers:**
- `X-Device-Id` (required): The persistent client-side device ID

**Response (200 OK):**
```json
{
  "id": "ticket_abc123",
  "success": true,
  "ticketId": "ticket_abc123"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Current device is not registered"
}
```

---

### 10. Mark Ticket Received

#### `POST /api/tickets/{ticketId}/receive`

**Purpose:** Mark a received ticket as processed.

**Request:**
```http
POST /api/tickets/ticket_abc123/receive HTTP/1.1
Host: sendme.leeapp.dev
Authorization: Bearer <jwt>
X-Device-Id: 550e8400-e29b-41d4-a716-446655440000
```

**Headers:**
- `X-Device-Id` (required): The persistent client-side device ID

**Response (200 OK):**
```json
{
  "success": true,
  "ticketId": "ticket_abc123",
  "markedAt": "2026-04-20T18:50:00Z"
}
```

---

## WebSocket Endpoints

### `GET /api/ws`

**Purpose:** Upgrade to WebSocket for real-time updates.

**Connection URL (Browser):**
```
wss://sendme.leeapp.dev/api/ws?deviceId=550e8400-e29b-41d4-a716-446655440000&token=eyJhbGc...
```

**Connection URL (Tauri):**
```
wss://sendme.leeapp.dev/api/ws?deviceId=550e8400-e29b-41d4-a716-446655440000&token=Bearer%20eyJhbGc...
```

**Headers (on upgrade request):**
```
GET /api/ws?deviceId=...&token=... HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Authorization: Bearer <jwt>  (alternative to token query param)
X-Device-Id: 550e8400-e29b-41d4-a716-446655440000  (alternative to deviceId query param)
```

**Response (101 Switching Protocols):**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**Initial Message from Server:**
```json
{
  "type": "devices",
  "data": [
    {
      "id": "device_123456",
      "name": "My MacBook Pro",
      "platform": "macos",
      "online": true,
      "lastSeenAt": "2026-04-20T18:30:00Z"
    }
  ]
}
```

---

## WebSocket Message Types

### Client → Server

#### Heartbeat / Ping
```json
{
  "type": "heartbeat"
}
```
or
```json
{
  "type": "ping"
}
```

---

### Server → Client

#### Devices Update
```json
{
  "type": "devices",
  "data": [
    {
      "id": "device_123456",
      "name": "My MacBook Pro",
      "platform": "macos",
      "online": true,
      "lastSeenAt": "2026-04-20T18:30:00Z"
    },
    {
      "id": "device_789012",
      "name": "iPhone",
      "platform": "ios",
      "online": false,
      "lastSeenAt": "2026-04-19T14:20:00Z"
    }
  ]
}
```

#### Device Update (single)
```json
{
  "type": "device_update",
  "data": {
    "id": "device_123456",
    "name": "My MacBook Pro (Updated)",
    "online": false,
    "lastSeenAt": "2026-04-20T19:00:00Z"
  }
}
```

#### Tickets Update
```json
{
  "type": "tickets",
  "data": [
    {
      "id": "ticket_abc123",
      "senderName": "John Doe",
      "filename": "document.pdf",
      "fileSize": 2048576,
      "createdAt": "2026-04-20T15:00:00Z"
    }
  ]
}
```

#### Friends Update
```json
{
  "type": "friends",
  "data": [
    {
      "id": "friend_rel_123",
      "userId": "user_123456",
      "friendUserId": "user_999999",
      "status": "accepted",
      "createdAt": "2026-03-15T08:00:00Z",
      "updatedAt": "2026-03-16T10:00:00Z",
      "acceptedAt": "2026-03-16T10:00:00Z",
      "friend": {
        "id": "user_999999",
        "name": "John Doe",
        "email": "john@example.com",
        "image": "https://avatar.example.com/john.jpg"
      },
      "friendDevices": [
        {
          "id": "device_456789",
          "name": "John's iPhone",
          "platform": "ios",
          "online": true,
          "lastSeenAt": "2026-04-20T17:45:00Z"
        }
      ]
    }
  ]
}
```

#### Transfer Received
```json
{
  "type": "transfer_received",
  "data": {
    "ticketId": "ticket_abc123",
    "filename": "document.pdf",
    "fileSize": 2048576
  }
}
```

#### Pong
```json
{
  "type": "pong"
}
```

#### Error
```json
{
  "type": "error",
  "data": "Device not registered"
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing deviceId"
}
```

### 401 Unauthorized
```
Unauthorized: Invalid token
```

### 404 Not Found
```json
{
  "error": "Device not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## Request Payloads Summary

| Endpoint | Method | Content-Type | Body | Auth |
|----------|--------|--------------|------|------|
| `/api/devices` | POST | application/json | `{ deviceId, name?, hostname? }` | Bearer |
| `/api/devices` | GET | — | — | Bearer |
| `/api/devices/{id}` | DELETE | — | — | Bearer |
| `/api/devices/{id}/heartbeat` | PUT | — | — | Bearer |
| `/api/friends` | GET | — | — | Bearer |
| `/api/friends` | POST | application/json | `{ email }` | Bearer |
| `/api/friends/{id}` | DELETE | — | — | Bearer |
| `/api/tickets` | GET | — | — | Bearer |
| `/api/tickets` | POST | application/json | `{ friendUserId, ticket, filename?, fileSize? }` | Bearer |
| `/api/tickets/{id}/receive` | POST | — | — | Bearer |
| `/api/ws` | GET | — | — | Bearer (header or query) |

---

## Tauri Bindings

Generated from Rust backend via `tauri::generate_handler!`:

```typescript
// app/src/bindings.ts

export interface StartCloudPresenceRequest {
  deviceId: string;
  apiOrigin: string;
}

export interface CloudPresenceState {
  active: boolean;
  connected: boolean;
  deviceId?: string;
  lastError?: string;
  friends: CloudFriendPayload[];
  devices: CloudDevicePayload[];
  tickets: CloudTicketPayload[];
}

export async function start_cloud_presence(
  request: StartCloudPresenceRequest,
): Promise<CloudPresenceState> {
  return await invoke("start_cloud_presence", { request });
}

export async function stop_cloud_presence(): Promise<void> {
  return await invoke("stop_cloud_presence");
}

export async function get_cloud_presence_state(): Promise<CloudPresenceState> {
  return await invoke("get_cloud_presence_state");
}
```

---

## Rate Limiting & Throttling

*Not explicitly documented; infer from TTLs:*

- **Device Registration:** 60-second TTL (maximum once per minute per device)
- **Heartbeat/Keepalive:** Every 30 seconds on WebSocket
- **Ticket Operations:** No explicit limit; guard pattern prevents duplicate registrations

---

## Changelog

- **v0.1.3 (2026-04-20)** — Initial cloud API contract
  - 10 HTTP endpoints
  - 1 WebSocket endpoint
  - 7 WebSocket message types
  - Device registration guard pattern
  - Clerk JWT authentication
