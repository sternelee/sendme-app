# WebSocket Implementation Documentation Index

## 📚 Available Documents

This repository now contains comprehensive documentation of the browser app's WebSocket implementation. Choose the right document for your needs:

### 1. **WEBSOCKET_ANALYSIS.md** (543 lines)
**The Complete Deep Dive** - Read this first for comprehensive understanding

Contents:
- WebSocket connection architecture (client & server)
- Server-side infrastructure (API route & Durable Object)
- All message types with detailed explanations
- File transfer flow (tickets) for both device-to-device and friend-to-friend
- Client-side state management
- Device online/offline tracking
- Complete message format examples
- Summary flow diagrams
- Key design decisions
- Error handling strategies

**Best for**: Getting the full picture, understanding architecture decisions, implementation details

---

### 2. **WEBSOCKET_MESSAGE_PROTOCOL.md** (568 lines)
**Protocol Reference with Examples** - Use this as a reference guide

Contents:
- Quick reference of all message types
- Detailed message structures with TypeScript types
- Real JSON examples for each message type
- Complete connection flow timeline
- File transfer flow with all 4 stages (send, create, notify, confirm)
- Message size considerations
- Connection parameters table
- Complete file transfer example walkthrough
- Error case handling

**Best for**: Protocol specifications, JSON message examples, implementing clients/servers, debugging

---

### 3. **WEBSOCKET_QUICK_REFERENCE.md** (375 lines)
**At-a-Glance Reference** - Quick lookup guide

Contents:
- Key files table with purposes
- Connection overview diagram
- Message types summary table
- Simplified file transfer flow
- Authentication flow
- Ticket data model
- Connection parameters
- Device online/offline logic
- Durable Object state structure
- Broadcast endpoints reference
- Component integration matrix
- Key design insights
- Testing WebSocket tips
- Performance notes
- Reconnection strategy

**Best for**: Quick lookups, onboarding new developers, remembering parameter values, testing

---

## 🎯 How to Use These Docs

### "I want to understand how WebSocket works"
→ Start with **WEBSOCKET_QUICK_REFERENCE.md** (5 min read)
→ Then read **WEBSOCKET_ANALYSIS.md** sections 1-3 (15 min)

### "I need to implement a WebSocket client"
→ Read **WEBSOCKET_MESSAGE_PROTOCOL.md** section "Quick Reference" and "Detailed Message Structures"
→ Use examples from "Message Format Examples" section

### "I need to debug a WebSocket issue"
→ Check **WEBSOCKET_QUICK_REFERENCE.md** for parameter values
→ Look at **WEBSOCKET_ANALYSIS.md** section 11 "Error Handling"
→ Use **WEBSOCKET_MESSAGE_PROTOCOL.md** to decode messages

### "I need to implement the server side"
→ Read **WEBSOCKET_ANALYSIS.md** sections 2-5
→ Reference file paths in **WEBSOCKET_QUICK_REFERENCE.md** "Key Files"
→ Study Durable Object state in **WEBSOCKET_QUICK_REFERENCE.md**

### "I need to understand file transfers"
→ **WEBSOCKET_QUICK_REFERENCE.md** "File Transfer Flow" section
→ **WEBSOCKET_MESSAGE_PROTOCOL.md** "File Transfer Flow Examples"
→ **WEBSOCKET_ANALYSIS.md** section 4

### "I need to verify a message format"
→ **WEBSOCKET_MESSAGE_PROTOCOL.md** "Detailed Message Structures" and "Quick Reference"
→ Look for exact TypeScript types and JSON examples

---

## 🔑 Key Concepts at a Glance

### Connection Model
- **Per User**: One Durable Object per user ID
- **Per Device**: Tracks which device has which WebSocket session
- **Per Tab**: One shared singleton connection per browser tab
- **Persistent**: Survives component unmounts via `createRoot()`

### Message Model
- **Push-based**: Server sends updates, not client polling
- **Event-driven**: Tickets, friends, devices sent when changed
- **Heartbeat**: 30-second keep-alive also updates device status
- **Bidirectional**: Client can send `heartbeat`, `ping`

### File Transfer Model
- **Ticket-based**: Sender creates ticket, receiver downloads using ticket
- **Two types**: Device-to-device (same user) and friend-to-friend (different users)
- **Confirmation**: Receiver marks as received, sender gets notification via WebSocket
- **24-hour expiry**: Automatic cleanup via query-time filtering

### State Management
- **Signals**: Solid.js reactive signals for devices, tickets, friends
- **Optimistic updates**: Remove ticket from client state immediately on action
- **Server of truth**: DB is authoritative, WS is for push notifications

---

## 📊 Quick Stats

| Metric | Value |
|--------|-------|
| Total documentation lines | 1,486 |
| Message types | 7 |
| Client-to-server message types | 2 |
| File transfer handshake steps | 4 |
| Key files referenced | 7 |
| Heartbeat interval | 30 seconds |
| Device timeout | 5 minutes |
| Ticket TTL | 24 hours |
| Reconnect strategy | Exponential backoff (1s-30s) |

---

## 🔍 Message Type Quick Lookup

| Need | Document | Section |
|------|----------|---------|
| List all message types | QR (all sections) | Messages |
| Transfer received format | Protocol | "Transfer Received Message" |
| Device structure | Protocol | "Devices Message" |
| Ticket structure | Protocol | "Tickets Message" |
| Friends structure | Protocol | "Friends Message" |
| File transfer steps | Protocol | "Complete File Transfer Flow" |
| Connection flow | Protocol | "Connection Flow Timeline" |
| Error handling | Analysis | Section 11 |

---

## 🏗️ Architecture Reference

```
Browser App (Client)
│
└─ useWebSocket() [Singleton Hook]
   │
   ├─ WebSocket Connection
   │  └─ GET /api/ws?deviceId=X&token=JWT
   │     │
   │     └─ Cloudflare Worker (ws.ts)
   │        │
   │        ├─ Validate auth
   │        ├─ Verify device
   │        │
   │        └─ Route to Durable Object
   │           │
   │           └─ UserDO (per userId)
   │              │
   │              ├─ Accept WebSocket
   │              ├─ Track sessions
   │              ├─ Send initial state
   │              │
   │              └─ Handle messages:
   │                 ├─ heartbeat → update lastSeenAt
   │                 ├─ ping → pong
   │                 └─ (internal broadcasts from API)
   │
   ├─ State Signals
   │  ├─ devices()
   │  ├─ tickets()
   │  ├─ friends()
   │  └─ isConnected()
   │
   └─ Actions
      ├─ markTicketReceived()
      └─ deleteTicket()

Complementary APIs
│
├─ POST /api/tickets
│  └─ Creates ticket + broadcasts via DO.broadcast/tickets
│
├─ POST /api/tickets/{id}/receive
│  └─ Marks received + broadcasts via DO.broadcast/transfer_received
│
└─ DELETE /api/tickets
   └─ Deletes ticket
```

---

## 🔐 Authentication & Security

- **Method**: Clerk JWT passed as query parameter (browser limitation)
- **Validation**: Server validates JWT before WebSocket upgrade
- **Device Registration**: Must be registered before WebSocket handshake
- **Durable Object ID**: Keyed by userId (prevents cross-user access)
- **Ticket Ownership**: Validated in all operations

---

## 🚀 Getting Started

### For New Contributors

1. **Start here**: Read WEBSOCKET_QUICK_REFERENCE.md (10 min)
2. **Understand flow**: Read "Connection Overview" and "File Transfer Flow"
3. **Check parameters**: Reference the tables for timeouts, intervals, etc.
4. **Study messages**: Look at examples in WEBSOCKET_MESSAGE_PROTOCOL.md
5. **Dive deep**: Read relevant sections of WEBSOCKET_ANALYSIS.md as needed

### For Debugging

1. **Identify issue**: Check WEBSOCKET_QUICK_REFERENCE.md error handling
2. **Monitor messages**: Use Browser DevTools to watch WebSocket in Network tab
3. **Check parameters**: Verify heartbeat interval, timeouts, etc.
4. **Decode message**: Use WEBSOCKET_MESSAGE_PROTOCOL.md examples
5. **Trace flow**: Follow the flow diagram in WEBSOCKET_ANALYSIS.md section 9

### For Implementation

1. **Client side**: Use WEBSOCKET_MESSAGE_PROTOCOL.md for message types
2. **Server side**: Study Durable Object in WEBSOCKET_ANALYSIS.md section 2
3. **Broadcast logic**: Reference broadcast endpoints in WEBSOCKET_QUICK_REFERENCE.md
4. **Error handling**: Read WEBSOCKET_ANALYSIS.md section 11

---

## 📋 File Cross-References

### Files Documented

| File | Covered In |
|------|-----------|
| browser/src/lib/composables/useWebSocket.ts | Analysis (1,6), QR (all), Protocol (1,3) |
| browser/src/routes/api/ws.ts | Analysis (2), QR (key files) |
| browser/src/worker/durable-objects/user.ts | Analysis (2-3,5), QR (durable object state) |
| browser/src/routes/api/tickets/index.ts | Analysis (4), QR (file transfer) |
| browser/src/routes/api/tickets/[id]/receive.ts | Analysis (4), Protocol (transfer received) |
| browser/src/lib/composables/useTicketPolling.ts | Analysis (6) |
| browser/src/lib/db/schema.ts | Analysis (4), Protocol (ticket structure) |

---

## ✅ Verification Checklist

Before implementing changes, verify:

- [ ] Understand the message type you're working with
- [ ] Know the Ticket status values (pending, received, expired)
- [ ] Confirm heartbeat interval (30 seconds)
- [ ] Check device timeout (5 minutes)
- [ ] Verify ticket TTL (24 hours)
- [ ] Understand single Durable Object per user
- [ ] Know WebSocket connection parameters
- [ ] Understand file transfer 4-step flow
- [ ] Verify ticket filtering logic
- [ ] Check error handling for your case

---

## 📞 Questions?

If you need more detail on:

1. **Message protocol** → WEBSOCKET_MESSAGE_PROTOCOL.md
2. **Implementation details** → WEBSOCKET_ANALYSIS.md
3. **Parameter values** → WEBSOCKET_QUICK_REFERENCE.md
4. **Examples** → WEBSOCKET_MESSAGE_PROTOCOL.md "Examples" sections

All three documents cross-reference each other for easy navigation.

---

## 📄 Document Information

- **Created**: April 20, 2026
- **Status**: Complete documentation of WebSocket implementation
- **Scope**: Browser app's real-time communication system
- **Accuracy**: Based on actual source code analysis
- **Update frequency**: Update when WebSocket protocol changes

---

