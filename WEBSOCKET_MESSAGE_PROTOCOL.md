# WebSocket Message Protocol Reference

## Quick Reference: Message Types

### Client to Server

```json
{ "type": "heartbeat" }
{ "type": "ping" }
```

### Server to Client

```json
// Device list
{ "type": "devices", "data": [...] }

// Incoming file transfers
{ "type": "tickets", "data": [...] }

// Friends & their devices
{ "type": "friends", "data": [...] }

// Single device status change
{ "type": "device_update", "data": { "id": "...", "online": true } }

// File was downloaded successfully
{ "type": "transfer_received", "data": { "ticketId": "...", "filename": "...", "fileSize": 12345 } }

// Keepalive response
{ "type": "pong" }

// Error
{ "type": "error", "data": "error message" }
```

---

## Detailed Message Structures

### 1. Devices Message

**When Sent**: 
- On WebSocket connect (initial state)
- After heartbeat updates device status
- When user's device comes online/goes offline

**Structure**:
```typescript
{
  type: "devices",
  data: [
    {
      id: string;              // UUID
      userId: string;          // User who owns this device
      platform: string;        // "web" | "windows" | "mac" | "linux" | "android" | "ios"
      deviceId: string;        // Persistent device ID
      name: string;            // "My Laptop", "iPhone", etc.
      ipAddress: string;       // Current IP
      hostname: string;        // Device model/hostname
      userAgent: string;       // Browser user agent (for web)
      online: boolean;         // true if lastSeenAt < 5 minutes ago
      lastSeenAt: Date;        // Last activity timestamp
      createdAt: Date;
      updatedAt: Date;
    }
  ]
}
```

**Example**:
```json
{
  "type": "devices",
  "data": [
    {
      "id": "dev-uuid-1",
      "userId": "user-123",
      "platform": "web",
      "deviceId": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Work Laptop",
      "ipAddress": "192.168.1.100",
      "hostname": "MacBook Pro",
      "userAgent": "Mozilla/5.0...",
      "online": true,
      "lastSeenAt": "2026-04-20T18:05:00Z",
      "createdAt": "2026-04-10T10:00:00Z",
      "updatedAt": "2026-04-20T18:05:00Z"
    }
  ]
}
```

---

### 2. Tickets Message (Incoming Files)

**When Sent**:
- On WebSocket connect (initial state)
- After new ticket is created by sender
- After ticket is marked as received
- When expired tickets are filtered out

**Structure**:
```typescript
{
  type: "tickets",
  data: [
    {
      id: string;              // UUID of ticket
      userId: string;          // Recipient (receiver)
      fromUserId: string | null;  // Sender (null for device-to-device)
      fromDeviceId: string;    // Source device ID
      toUserId: string | null; // Recipient user (null for device-to-device)
      toDeviceId: string | null;  // Recipient device (null for friend transfers)
      ticket: string;          // Iroh ticket string "iroh:..."
      filename: string | null; // File name
      fileSize: number | null; // Bytes
      status: "pending" | "received" | "expired";
      expiresAt: Date;         // Expiration (24h from creation)
      createdAt: Date;
      updatedAt: Date;
      receivedAt: Date | null; // When marked received
    }
  ]
}
```

**Example**:
```json
{
  "type": "tickets",
  "data": [
    {
      "id": "ticket-uuid-1",
      "userId": "user-456",
      "fromUserId": "user-123",
      "fromDeviceId": "dev-uuid-1",
      "toUserId": "user-456",
      "toDeviceId": null,
      "ticket": "iroh:yey27z4w4p5ij3s7",
      "filename": "presentation.pdf",
      "fileSize": 2048576,
      "status": "pending",
      "expiresAt": "2026-04-21T18:00:00Z",
      "createdAt": "2026-04-20T18:00:00Z",
      "updatedAt": "2026-04-20T18:00:00Z",
      "receivedAt": null
    }
  ]
}
```

**Filtering Logic** (what gets sent to a device):
- Must have `status: "pending"`
- Must not be expired (`expiresAt > now`)
- Must match one of:
  - Targeted to this device: `toDeviceId === currentDeviceId`
  - Targeted to user (friend transfer): `toUserId === userId && toDeviceId === null`
  - No device in DB: friend transfers only

---

### 3. Friends Message

**When Sent**:
- On WebSocket connect (initial state)
- When friend comes online/goes offline
- When friend list is updated
- When user accepts/sends friend request

**Structure**:
```typescript
{
  type: "friends",
  data: [
    {
      id: string;              // UUID of friendship record
      userId: string;          // User who initiated request
      friendUserId: string;    // User who received request
      status: "pending" | "accepted";
      createdAt: Date;
      updatedAt: Date;
      acceptedAt: Date | null; // When request was accepted
      friend: {
        id: string;            // The friend's user ID
        name: string;
        email: string;
        image: string | null;  // Avatar URL
      };
      friendDevices: [
        {
          id: string;          // Device UUID
          name: string;        // Device name
          platform: string;    // "web", "mobile", etc.
          online: boolean;     // true if lastSeenAt < 5 min
          lastSeenAt: Date;
        }
      ]
    }
  ]
}
```

**Example**:
```json
{
  "type": "friends",
  "data": [
    {
      "id": "friend-uuid-1",
      "userId": "user-123",
      "friendUserId": "user-456",
      "status": "accepted",
      "createdAt": "2026-04-01T10:00:00Z",
      "updatedAt": "2026-04-20T18:00:00Z",
      "acceptedAt": "2026-04-02T11:00:00Z",
      "friend": {
        "id": "user-456",
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "image": "https://example.com/avatars/alice.jpg"
      },
      "friendDevices": [
        {
          "id": "dev-uuid-2",
          "name": "Alice's Phone",
          "platform": "ios",
          "online": true,
          "lastSeenAt": "2026-04-20T18:05:00Z"
        }
      ]
    }
  ]
}
```

---

### 4. Transfer Received Message ⭐

**When Sent**: ⭐ **KEY FOR FILE TRANSFERS**
- After recipient marks ticket as "received" (`POST /api/tickets/{id}/receive`)
- Sent to the sender's WebSocket
- Indicates successful file download

**Triggers**: Only sent for friend-to-friend transfers (`fromUserId !== null`)

**Structure**:
```typescript
{
  type: "transfer_received",
  data: {
    ticketId: string;        // UUID of the completed ticket
    filename: string | null; // Original filename
    fileSize: number | null; // Bytes
  }
}
```

**Example**:
```json
{
  "type": "transfer_received",
  "data": {
    "ticketId": "ticket-uuid-1",
    "filename": "photo.jpg",
    "fileSize": 1048576
  }
}
```

**Client Handling**:
- Parse filename and fileSize
- Display success toast: `"photo.jpg (1.0 MB) was downloaded by the recipient."`
- Log to transfer history

**Size Formatting**:
```javascript
if (fileSize < 1024 * 1024) {
  // < 1 MB: show in KB
  sizeStr = `${(fileSize / 1024).toFixed(1)} KB`;
} else {
  // >= 1 MB: show in MB
  sizeStr = `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}
```

---

### 5. Device Update Message

**When Sent**:
- When a specific device's status changes (optimization)
- Instead of re-sending entire device list

**Structure**:
```typescript
{
  type: "device_update",
  data: {
    id: string;           // Device UUID
    online?: boolean;
    lastSeenAt?: Date;
    // ... any other changed fields
  }
}
```

**Example**:
```json
{
  "type": "device_update",
  "data": {
    "id": "dev-uuid-1",
    "online": false,
    "lastSeenAt": "2026-04-20T18:15:00Z"
  }
}
```

**Client Handling**:
- Update matching device in devices signal
- Trigger re-render of device list

---

## Connection Flow Timeline

### 1. Initial Connection

```
Client                              Server                     Durable Object
  |                                   |                              |
  +--- GET /api/ws?deviceId=...---->  |                              |
  |    Upgrade: websocket             |                              |
  |                                   +--- Validate auth ----->       |
  |                                   +--- Verify device ----->       |
  |                                   +--- Route to DO ------>        |
  |                                   |                              |
  |                                   |  fetch(WebSocket upgrade)     |
  |                                   |<---- 101 Switching Protocols-|
  |                                   |                              |
  |<----- 101 Switching Protocols-----+                              |
  |                                   |                              |
  |                                   +---- acceptWebSocket()        |
  |                                   +---- sendInitialState() ----->|
  |                                   |                              |
  |<-------- devices message----------+--------- (send to WS)        |
  |<-------- tickets message----------+--------- (send to WS)        |
  |<-------- friends message----------+--------- (send to WS)        |
```

### 2. Heartbeat (every 30 seconds)

```
Client                              Server                     Database
  |                                   |                         |
  +---- { type: "heartbeat" } ------> |                         |
  |                                   +-- updateHeartbeat() --->|
  |                                   |<------ updated? ------+ |
  |                                   |                         |
  |                                   if (updated) {            |
  |                                   +-- broadcastDevices() -- broadcast to all sessions
  |                                   }
```

### 3. File Transfer: Send Side

```
Client (Sender)                     Server                    DB                DO
  |                                  |                        |                 |
  +-- POST /api/tickets ----->       |                        |                 |
  |    { ticket, filename,           |                        |                 |
  |      fileSize, friendUserId }    |                        |                 |
  |                                  +-- Validate ------->    |                 |
  |                                  |                        |                 |
  |                                  +-- Create ticket -->    |                 |
  |                                  |<-- ticket record ------+                 |
  |                                  |                                         |
  |                                  +-- POST /broadcast/tickets ------------->|
  |                                  |                        |        +-- Send tickets msg
  |<---- 200 OK (ticket) -----------+                        |        |  to receiver WS
  |
```

### 4. File Transfer: Receive Side

```
Client (Receiver)                   DO                      Sender's Client
  |                                  |                          |
  |<---- { type: "tickets" } --------+                          |
  |      [incoming file]             |                          |
  |                                  |                          |
  | Click "Download"                 |                          |
  +-- receiveFile(ticket) ---------->|<--- Iroh connection ----->|
  |                                  |   (P2P file transfer)     |
  +<---------- file data -----------+<----- file data -----------+
  |                                  |
  (download completes)
  |
  +-- POST /api/tickets/{id}/receive->
  |                                  +-- Mark as received -->DB
  |                                  +-- POST /broadcast/
  |                                  |   transfer_received ----->|
  |                                  |                    +-- Send transfer_received
  |                                  |                    |  to sender's WS
  |                                  |
  |<---- 200 OK ---------------------+
  |
  (Sender receives)
  |<-------- { type: "transfer_received" } ----+
  |        { ticketId, filename, fileSize }    |
  |
  Toast: "filename (size) was downloaded"
```

---

## Message Size Considerations

- **devices**: ~500 bytes per device (max ~50 devices × 500 = 25KB)
- **tickets**: ~300 bytes per ticket (max ~20 tickets × 300 = 6KB)
- **friends**: ~1-2KB per friend (max ~50 friends = 100KB)
- **transfer_received**: ~200 bytes (small, frequent)
- **Total typical message**: 5-30KB, can spike to 100KB+ with many friends

## Connection Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Heartbeat Interval | 30 seconds | Client to server |
| Device Timeout | 5 minutes | Time before marked offline |
| Ticket Expiration | 24 hours | From creation |
| Reconnect Base Delay | 1 second | Exponential backoff |
| Reconnect Max Delay | 30 seconds | Cap on backoff |
| Device Registration TTL | Per connection | Batched to prevent flooding |

---

## Example: Complete File Transfer Flow

### 1. Sender Creates Ticket (Browser opens SendTab)
```
Sender:
  1. Selects file via UI
  2. Calls sendFile(file)
  3. WASM Iroh node generates ticket: "iroh:yey27z4..."
  4. WASM starts listening for receiver

UI:
  5. POST /api/tickets {
       friendUserId: "receiver-123",
       ticket: "iroh:yey27z4...",
       filename: "photo.jpg",
       fileSize: 2048576
     }
  6. Server creates Ticket in DB
  7. Server calls USER_DO.broadcast/tickets(receiverId)
```

### 2. Receiver Notified (WebSocket)
```
Receiver's DO session receives broadcast request:
  POST https://do/broadcast/tickets with userId: "receiver-123"

DO queries DB for receiver's tickets:
  SELECT * FROM tickets 
  WHERE userId = "receiver-123" 
  AND status = "pending"
  AND expiresAt > now()
  AND (toDeviceId = current OR toUserId IS NOT NULL)

DO sends to all receiver's WebSocket sessions:
  {
    "type": "tickets",
    "data": [{
      "id": "ticket-uuid",
      "userId": "receiver-123",
      "fromUserId": "sender-123",
      "ticket": "iroh:yey27z4...",
      "filename": "photo.jpg",
      "fileSize": 2048576,
      "status": "pending",
      ...
    }]
  }

Receiver's Client:
  ReceiveTab component receives tickets signal update
  UI shows: "photo.jpg (2.0 MB) from Alice" with Download button
```

### 3. Receiver Accepts (Downloads File)
```
Receiver clicks "Download":
  1. extractTicket("iroh:yey27z4...")
  2. Call receiveFile(ticket)
  3. WASM Iroh connects to sender via ticket
  4. Receives file data via P2P
  5. Saves to browser download dir
  6. On success: call markTicketReceived(ticketId)

markTicketReceived():
  POST /api/tickets/{ticket-uuid}/receive {
    Authorization: Bearer <jwt>
  }

  Server updates Ticket:
    UPDATE tickets
    SET status = "received", receivedAt = now()
    WHERE id = "ticket-uuid" AND userId = "receiver-123"

  Server broadcasts to receiver:
    USER_DO.broadcast/tickets(receiverId)
    → Updates receiver's tickets list (removes it)

  Server broadcasts to sender:
    USER_DO.broadcast/transfer_received(senderId)
    → Sends { type: "transfer_received", data: {...} }
```

### 4. Sender Notified (Download Complete)
```
Sender's WebSocket receives:
  {
    "type": "transfer_received",
    "data": {
      "ticketId": "ticket-uuid",
      "filename": "photo.jpg",
      "fileSize": 2048576
    }
  }

Client Toast Handler:
  "photo.jpg (2.0 MB) was downloaded by the recipient."

(Transfer complete!)
```

---

## Error Cases

### File Too Large
- Browser download limit (typically OK, handled by browser)
- Network interruption: Iroh handles retry
- Ticket expires during transfer: Receiver can't mark as received

### Receiver Offline During Send
- Ticket created in DB with `toUserId = receiver-123`
- Receiver's DO doesn't have active sessions
- When receiver comes online, DO sends tickets message
- Receiver can then download (if not expired)

### Sender Offline During Download
- Receiver tries to use ticket
- Iroh connection fails
- Receiver sees error, can retry later
- Ticket remains pending

### Ticket Expires
- Server filters out `expiresAt < now()` in all queries
- Receiver won't see expired tickets
- Sender still sees in history

---

