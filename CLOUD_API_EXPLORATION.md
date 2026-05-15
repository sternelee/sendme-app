# Cloud API & WebSocket Architecture Exploration

**Date:** April 20, 2026  
**Scope:** Complete analysis of cloud API communication, authentication, and WebSocket infrastructure

---

## Quick Reference

### Cloud API Origin
- **Default:** `https://sendme.leeapp.dev`
- **Config (Tauri):** `VITE_BROWSER_API_ORIGIN` env var
- **Scheme conversion:** `https://` → `wss://` (WebSocket), `http://` → `ws://`

### Authentication
- **Method:** better-auth JWT (Bearer tokens)
- **Tauri:** System-browser OAuth + deep link callback (`sendme://auth/callback?token=...`)
- **Browser:** `authClient.getSession()` (better-auth Solid-JS client)
- **Header:** `Authorization: Bearer <token>`
- **WebSocket:** Query param fallback for browsers (can't set headers)

### Endpoints
```
HTTP:
  POST   /api/devices              # Device registration (auth required)
  GET    /api/friends              # List friends (auth required)
  POST   /api/friends              # Add friend
  DELETE /api/friends/{userId}     # Remove friend
  POST   /api/tickets              # Send ticket
  GET    /api/tickets              # Get tickets (deviceId param required)
  POST   /api/tickets/{id}/receive # Mark received

WebSocket:
  GET    /api/ws                   # Upgrade (deviceId & token params/headers)
```

### Device Registration Guard
- **Pattern:** Singleton per token:deviceId pair
- **TTL:** 60 seconds
- **Deduplication:** One in-flight request per pair
- **Payload:** `{ deviceId, name?, hostname? }`

### WebSocket Connection
**Tauri:**
```
URL: wss://sendme.leeapp.dev/api/ws?deviceId=<uuid>&token=<jwt>
Client: tokio_tungstenite::connect_async()
Heartbeat: Every 30s, sends {"type":"heartbeat"}
Messages: Friends, Devices, Tickets, Error, Pong, TransferReceived
```

**Browser:**
```
URL: wss://localhost/api/ws?deviceId=<uuid>&token=<jwt>
Client: Browser WebSocket API
Heartbeat: Every 30s, sends {"type":"ping"}
Messages: Devices, Tickets, Friends, DeviceUpdate, Pong, Error, TransferReceived
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloud API (sendme.leeapp.dev)            │
│                  Cloudflare Workers + Durable Objects          │
│                                                                 │
│  ┌──────────────────────┐         ┌─────────────────────────┐  │
│  │  GET /api/ws         │         │  POST /api/devices      │  │
│  │  (WebSocket Handler) │◄────────│  (Device Registration)  │  │
│  │                      │         │                         │  │
│  │  validates token     │         │  validates Bearer token │  │
│  │  checks device reg   │         │  stores device metadata │  │
│  │  routes to User DO   │         └─────────────────────────┘  │
│  └──────────────────────┘                                       │
│           ▲                                                     │
│           │ WebSocket                                          │
│           │ (duplex)                                           │
│           │                                                     │
└───────────┼─────────────────────────────────────────────────────┘
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
  ┌──────────┐  ┌──────────────┐
  │  Tauri   │  │    Browser   │
  │   App    │  │     App      │
  │          │  │              │
  │ Rust BE: │  │ SolidJS FE:  │
  │ reqwest  │  │   fetch()    │
  │ tungstenite  │ WebSocket    │
  └──────────┘  └──────────────┘
```

---

## File Mapping

### Tauri App
| File | Purpose |
|------|---------|
| `app/src/lib/cloud-api.ts` | URL builders, token extraction, device ID helpers |
| `app/src/lib/friends.ts` | HTTP API service (GET/POST/DELETE friends, tickets) |
| `app/src/app.tsx` | PresenceConnector component (triggers `start_cloud_presence`) |
| `app/src/bindings.ts` | Generated Tauri command signatures |
| `app/src-tauri/Cargo.toml` | Dependencies: `reqwest`, `tokio-tungstenite` |
| `app/src-tauri/src/lib.rs` | Core logic: WebSocket loop, device registration, message handlers |

### Browser App
| File | Purpose |
|------|---------|
| `browser/src/routes/api/ws.ts` | WebSocket upgrade handler (validates auth, routes to User DO) |
| `browser/src/lib/composables/useWebSocket.ts` | Connection manager, reconnection logic, message dispatch |
| `browser/src/lib/composables/deviceRegistration.ts` | Guard pattern: caching, deduplication, TTL |
| `browser/src/worker/durable-objects/user.ts` | Per-user session manager, message broadcasting |

---

## Key Data Flows

### 1. Tauri App Initialization
```
User signs in (better-auth OAuth)
  ↓
PresenceConnector effect fires
  ↓
Calls start_cloud_presence({ deviceId, apiOrigin })
  ↓
Tauri Backend (Rust):
  - normalize_cloud_presence_request()
  - spawn run_cloud_presence_loop()
  ↓
Loop:
  - Get bearer token from cached better-auth session
  - register device: POST /api/devices
  - build WS URL: wss://sendme.leeapp.dev/api/ws?deviceId=X&token=Y
  - connect_async(url)
  - heartbeat every 30s
  - handle_cloud_server_message() dispatches to frontend
```

### 2. Device Registration (Both Apps)
```
Before WebSocket connect:
  1. Check if registered recently (TTL 60s)
  2. If not:
     POST /api/devices
     {
       "deviceId": "uuid-...",
       "name": "My Device",
       "hostname": "My Device"
     }
     Header: Authorization: Bearer <jwt>
  3. Cache result with timestamp
  4. Proceed to WebSocket connect
```

### 3. WebSocket Message Flow
```
Client connects to wss://api.../api/ws?deviceId=X&token=Y

Server (browser/src/routes/api/ws.ts):
  1. Validate WebSocket upgrade header
  2. Extract token from query or Authorization header
  3. authenticateRequest() → verify better-auth session token
  4. Get persistentDeviceId from header or query
  5. Query DB: getUserDeviceByPersistentId()
  6. Route to Durable Object: env.USER_DO.get(id).fetch()

Durable Object (browser/src/worker/durable-objects/user.ts):
  1. Accept WebSocket (WebSocketPair)
  2. Send initial state (devices, tickets, friends)
  3. Track session in Map<WebSocket, deviceId>
  4. Listen for incoming messages (heartbeat, ping)
  5. Broadcast updates to all sessions:
     - devices_updated → sendDevices()
     - friends_updated → sendFriends()
     - tickets_updated → sendTickets()
```

---

## Authentication Patterns

### Pattern 1: HTTP Request (Tauri)
```rust
let token = current_cloud_authorization_header(app)?;  // Bearer <jwt>
let response = client
    .post(url)
    .header(AUTHORIZATION, format!("Bearer {token}"))
    .json(&payload)
    .send()
    .await?;
```

### Pattern 2: HTTP Request (Browser)
```typescript
const headers = await getAuthorizationHeaders();  // { Authorization: "Bearer <jwt>" }
const response = await fetch(url, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        ...headers,
    },
    body: JSON.stringify(payload),
});
```

### Pattern 3: WebSocket Connection (Tauri)
```rust
let ws_url = build_cloud_websocket_url(&origin, &device_id, &token)?;
// wss://api.../api/ws?deviceId=X&token=Bearer%20<jwt>
let (stream, _) = connect_async(ws_url.as_str()).await?;
```

### Pattern 4: WebSocket Connection (Browser)
```typescript
const token = await authClient.getSession().token;  // better-auth JWT
const urlWithToken = `${protocol}//${location.host}/api/ws?deviceId=${deviceId}&token=${token}`;
const ws = new WebSocket(urlWithToken);
```

---

## Rust Dependencies Used

### `app/src-tauri/Cargo.toml`
```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls-webpki-roots"] }
tokio-tungstenite = { version = "0.26", features = ["connect", "rustls-tls-webpki-roots"] }
```

**Usage:**
- `reqwest::Client::builder().user_agent(...).build()` → HTTP requests with auth
- `tokio_tungstenite::connect_async(url)` → WebSocket connections
- `Message::Text()` → Send heartbeat & receive server messages
- `futures_util::StreamExt` (via tungstenite) → `reader.next()`
- Both use `rustls-tls-webpki-roots` for TLS certificate validation

---

## Summary: Side-by-Side Comparison

| Feature | Tauri App | Browser App |
|---------|-----------|-------------|
| **Cloud Origin** | `https://sendme.leeapp.dev` | Same |
| **Auth Source** | better-auth browser OAuth + deep link | better-auth Solid-JS client |
| **HTTP Client** | `reqwest::Client` | Browser `fetch()` |
| **WebSocket Library** | `tokio-tungstenite` | Browser `WebSocket` API |
| **Device ID Storage** | localStorage | localStorage |
| **Registration Endpoint** | HTTP POST to `/api/devices` | HTTP POST to `/api/devices` |
| **Registration TTL** | 60 seconds | 60 seconds |
| **WebSocket URL Example** | `wss://.../api/ws?deviceId=X&token=Y` | `wss://.../api/ws?deviceId=X&token=Y` |
| **Heartbeat Interval** | 30 seconds | 30 seconds |
| **Heartbeat Message** | `{"type":"heartbeat"}` | `{"type":"ping"}` |
| **Reconnection** | Exponential backoff (1s–30s) | Exponential backoff (1s–30s) |
| **Message Broker** | Emits to frontend via `app.emit()` | Solid-JS signals |
| **Server Handler** | Tauri command + Rust loop | Cloudflare Workers + Durable Objects |

---

## Configuration

### Environment Variables

**Tauri App** (`app/.env.local.example`):
```bash
VITE_BROWSER_API_ORIGIN=https://sendme.leeapp.dev  # Optional; defaults to https://sendme.leeapp.dev
```

**Browser App** (`browser/.env.example`):
```bash
BETTER_AUTH_SECRET=...       # Session signing secret
GITHUB_CLIENT_ID=...         # OAuth credentials
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## Security Notes

1. **better-auth Integration:** Both apps use better-auth for authentication; tokens are JWTs with user identity claims
2. **Device Verification:** Server verifies device is registered before accepting WebSocket connections
3. **Query Param Fallback:** Browsers can't set custom headers on WebSocket, so token is passed as query param
4. **TLS Verification:** Both `reqwest` and `tokio-tungstenite` use `rustls-tls-webpki-roots` for cert validation
5. **Token Extraction:** Both apps properly extract `Bearer <token>` from `Authorization` header
6. **Persistent Device ID:** Client-side UUIDs prevent impersonation across devices (must be registered server-side)

---

## Potential Issues & Considerations

1. **Token Expiration:** JWTs may expire; apps should handle 401 responses and re-authenticate
2. **Query Param Encoding:** WebSocket URLs must properly encode special characters in query params
3. **WebSocket Buffering:** Large message payloads may need chunking
4. **Reconnection Storms:** Exponential backoff should prevent flooding server on repeated failures
5. **Device Registration Duplication:** Guard pattern prevents but TTL may need adjustment for longer-lived devices

