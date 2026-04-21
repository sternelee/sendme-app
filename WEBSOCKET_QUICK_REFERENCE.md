# WebSocket Implementation - Quick Reference Guide

## 🎯 Key Files

| File | Purpose |
|------|---------|
| `browser/src/lib/composables/useWebSocket.ts` | Client-side WebSocket hook (singleton) |
| `browser/src/routes/api/ws.ts` | WebSocket upgrade endpoint |
| `browser/src/worker/durable-objects/user.ts` | Durable Object handling connections |
| `browser/src/routes/api/tickets/index.ts` | Ticket creation/deletion |
| `browser/src/routes/api/tickets/[id]/receive.ts` | Mark ticket as received |
| `browser/src/lib/composables/useTicketPolling.ts` | Legacy wrapper (thin adapter) |
| `browser/src/lib/db/schema.ts` | Database schema (Ticket, Device, Friends) |

---

## 🔌 Connection Overview

```
Browser Client
    ↓
GET /api/ws (with deviceId & JWT token in query)
    ↓
Cloudflare Workers (ws.ts)
    ↓ Validates auth & device
    ↓
Durable Object (user.ts per userId)
    ↓
WebSocket established
    ↓
Persistent connection to receive push updates
```

---

## 📨 Message Types Sent To Client

| Type | When | Key Data | Example Use |
|------|------|----------|-------------|
| **devices** | Connect, heartbeat update | `Device[]` | Show list of user's devices |
| **tickets** | Connect, new file arrives, marked received | `Ticket[]` | Show incoming files |
| **friends** | Connect, friend comes online, list updates | `EnrichedFriend[]` | Show friends & their devices |
| **transfer_received** ⭐ | File downloaded by recipient | `{ticketId, filename, fileSize}` | Toast: "file downloaded" |
| **device_update** | Single device status changes | `{id, online, lastSeenAt}` | Optimize: don't resend all devices |
| **pong** | Response to ping | None | Keepalive test |
| **error** | Parse/process error | `string` | Log to console |

---

## 📤 Message Types Sent From Client

| Type | Interval/Trigger | Purpose |
|------|------------------|---------|
| **heartbeat** | Every 30 seconds | Keep device marked online |
| **ping** | Manual (diagnostic) | Test connection |

---

## 🔄 File Transfer Flow (Simplified)

### Sender Side
```
1. User selects file in SendTab
2. Calls sendFile() → WASM Iroh generates ticket: "iroh:..."
3. POST /api/tickets { friendUserId, ticket, filename, fileSize }
4. Server creates Ticket in DB (status: pending)
5. Server broadcasts /broadcast/tickets to receiver's DO
```

### Receiver Side
```
1. Receiver's WebSocket receives: { type: "tickets", data: [...] }
2. ReceiveTab shows incoming file with Download button
3. User clicks Download
4. Call receiveFile(ticketString) → WASM connects via Iroh
5. File downloads to browser
6. POST /api/tickets/{id}/receive (mark as received)
7. Server broadcasts /broadcast/transfer_received to sender
```

### Sender Confirmation
```
1. Sender's WebSocket receives:
   { type: "transfer_received", data: { ticketId, filename, fileSize } }
2. Toast: "photo.jpg (2.0 MB) was downloaded by the recipient."
```

---

## 🔐 Authentication Flow

```typescript
// Client constructs WebSocket URL with JWT in query (browsers can't use headers)
const url = `wss://example.com/api/ws?deviceId=${uuid}&token=${jwt}`;
const ws = new WebSocket(url);

// Server extracts token from query and validates
const token = url.searchParams.get("token");
const requestToAuth = new Request(url, {
  headers: { Authorization: `Bearer ${token}` }
});
const { userId } = await authenticateRequest(requestToAuth, env);

// Creates Durable Object using userId as stable ID
const id = env.USER_DO.idFromName(userId);
const stub = env.USER_DO.get(id);
```

---

## 💾 Ticket Data Model

```typescript
{
  id: string;              // UUID
  userId: string;          // Receiver
  fromUserId: string|null; // Sender (null = own device)
  fromDeviceId: string;    // Source device
  toUserId: string|null;   // Target user (null = own device)
  toDeviceId: string|null; // Target device (null = any device)
  ticket: string;          // Iroh ticket "iroh:..."
  filename: string|null;   // File name
  fileSize: number|null;   // Bytes
  status: "pending"|"received"|"expired";
  expiresAt: Date;         // 24h from creation
  receivedAt: Date|null;   // When marked received
}
```

### Two Transfer Types

**Device-to-Device** (same user):
- `fromUserId: null`, `toUserId: null`
- `toDeviceId` must be online
- Example: Phone → Laptop

**Friend-to-Friend** (different users):
- `fromUserId: sender`, `toUserId: receiver`
- `toDeviceId: null` (any of receiver's devices)
- Must be "accepted" friends

---

## ⚙️ Connection Parameters

| Parameter | Value |
|-----------|-------|
| Heartbeat interval | 30 seconds |
| Device timeout | 5 minutes (offline if no heartbeat) |
| Ticket TTL | 24 hours |
| Reconnect delay | 1s → exponential backoff → 30s max |
| Singleton scope | Per browser tab (via `createRoot()`) |

---

## 🔍 How Device Online/Offline Works

```
Device connects (WebSocket open)
    ↓
DO.handleDeviceConnected()
    ↓
updateDeviceHeartbeatByPersistentId() → sets lastSeenAt = now()
    ↓
broadcastPresence() → sends devices + friends to all user's sessions
    ↓
All connected devices see updated online status

---

Every 30 seconds:
Client sends { type: "heartbeat" }
    ↓
DO updates lastSeenAt in DB
    ↓
If DB changed: broadcasts devices list
    ↓
All devices see updated online status

---

All WebSocket sessions close:
DO.handleDisconnect() (for last session of device)
    ↓
markDeviceOfflineByPersistentId() → sets online = false
    ↓
broadcastPresence() → notifies user & friends
    ↓
Device marked offline everywhere
```

---

## 🏗️ Durable Object State

```typescript
class UserDO {
  // Which WebSocket session is on which device
  private sessions: Map<WebSocket, deviceId>;
  
  // Which device has which sessions (for multi-tab tracking)
  private deviceSessions: Map<deviceId, Set<WebSocket>>;
}
```

**Key logic:**
- When first WebSocket for a device connects → `handleDeviceConnected()`
- When last WebSocket for a device disconnects → mark device offline
- Broadcast goes to all connected sessions of the user

---

## 📊 Initial State on Connect

When WebSocket opens, DO immediately sends:

```typescript
await Promise.all([
  sendDevices(userId),    // All user's devices
  sendTickets(userId),    // Pending tickets for this user
  sendFriends(userId)     // All friendships + friend devices
]);
```

Then every 30 seconds, heartbeat keeps data fresh.

---

## 🚨 Error Handling

| Error | Handling |
|-------|----------|
| WebSocket closes | Exponential backoff reconnect |
| Parse failure | Logged, connection stays open |
| DB error | Logged to console, connection continues |
| Broadcast fails | Non-fatal, receiver will get data on next heartbeat |
| Device not registered | 400 error, prevents WebSocket upgrade |
| Invalid token | 401 error |

---

## 📍 Ticket Filtering (What Gets Sent)

Server queries tickets with conditions:

```sql
WHERE userId = {receiver}
  AND status = "pending"
  AND expiresAt > now()
  AND (
    toDeviceId = {currentDevice}  -- Device-to-device to THIS device
    OR (
      toUserId = {receiver}       -- Friend transfer (any device)
      AND toDeviceId IS NULL
    )
  )
```

So a receiver only sees:
- Tickets targeted to their current device
- Tickets from friends (no specific device target)

A friend transfer shows on ALL of receiver's online devices.

---

## 🎣 Broadcast Endpoints (Internal)

Called by API layer to trigger WebSocket messages:

```
POST https://do/broadcast/devices     { userId }
POST https://do/broadcast/tickets     { userId }
POST https://do/broadcast/friends     { userId }
POST https://do/broadcast/presence    { userId }
POST https://do/broadcast/transfer_received
                                       { ticketId, filename, fileSize }
```

Example call from Tickets API:
```typescript
const doId = env.USER_DO.idFromName(targetUserId);
const stub = env.USER_DO.get(doId);
await stub.fetch(
  new Request("https://do/broadcast/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: targetUserId })
  })
);
```

---

## 🔗 Component Integration

| Component | Uses | For |
|-----------|------|-----|
| **SendTab** | `useWebSocket().friends` | Show online friends to send to |
| **ReceiveTab** | `useWebSocket().tickets` | Show incoming files |
| **DeviceListModal** | `useWebSocket().devices` | Show user's devices |
| **FriendsTab** | `useWebSocket().friends` | Show friend list & status |

All use the same singleton instance (shared across tab).

---

## 💡 Key Design Insights

1. **Singleton Pattern**: One WS per tab, survives component unmounts via `createRoot()`

2. **JWT in Query**: Browsers can't set custom headers on WebSocket, so JWT goes in URL

3. **DO per User**: All devices connect to same DO (by userId), enables efficient broadcasting

4. **Heartbeat Strategy**: Keep-alive that also updates device status (dual purpose)

5. **Transfer Confirmation**: Sender doesn't poll; receiver explicitly calls mark-received endpoint, which broadcasts back to sender

6. **Ticket Expiration**: No cleanup job needed; filtered at query time (24h TTL)

7. **Multi-Device Tracking**: DO tracks all sessions per device to know when last one disconnects

8. **Optimistic Updates**: Client removes ticket from state on `markTicketReceived()` before server confirms

---

## 🧪 Testing WebSocket

**Monitor in DevTools:**
```javascript
// Check connection state
useWebSocket().isConnected()

// See current state
const { devices, tickets, friends, isConnected } = useWebSocket();
console.log({ devices: devices(), tickets: tickets(), friends: friends() });

// Manually test heartbeat
ws.send(JSON.stringify({ type: "ping" }));
```

**Browser DevTools:**
- Network tab → WS → Messages
- Watch JSON messages sent/received
- Check heartbeat every 30s
- Monitor size of devices/tickets/friends arrays

---

## 📈 Performance Notes

- **Message frequency**: Heartbeat every 30s, plus event-driven updates
- **Typical payload**: 5-30KB (can spike to 100KB+ with many friends)
- **Concurrent connections**: One per browser tab
- **State sync**: Eventual consistency (within 30s if no events)
- **Backlog**: No queuing; only latest state is sent (no missed message recovery)

---

## 🔄 Reconnection Strategy

```
Attempt 1: wait 1s
Attempt 2: wait 2s
Attempt 3: wait 4s
Attempt 4: wait 8s
Attempt 5: wait 16s
Attempt 6+: wait 30s (capped)
```

Resets to 1s on successful connection.

---

