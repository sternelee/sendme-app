# Nearby Transfer Protocol Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Implement P2P file transfer between nearby devices using iroh Endpoint direct connection

**Architecture:**
- Uses iroh Endpoint with custom ALPN for connection establishment
- Bi-directional streams for control messages (Hello, Offer, Accept/Decline, BlobTicket)
- iroh-blobs for actual file transfer via ticket mechanism
- mDNS for device discovery (already implemented)

**Tech Stack:** iroh, iroh-blobs, mdns-sd, tokio

---

## Chunk 1: Protocol Messages & Types

**Files:**
- Create: `lib/src/nearby/protocol.rs`
- Modify: `lib/src/nearby/mod.rs`

- [ ] **Step 1: Create lib/src/nearby/protocol.rs**

```rust
//! Protocol messages for nearby transfer

use serde::{Deserialize, Serialize};

/// ALPN protocol identifier
pub const ALPN: &[u8] = b"sendme/transfer/v1";

/// Control messages sent over bi-stream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Message {
    /// Hello - exchange device identity
    Hello {
        device_name: String,
        device_type: String,
        endpoint_id: String,
    },
    /// Offer - sender sends file manifest
    Offer {
        files: Vec<FileInfo>,
        total_size: u64,
    },
    /// Accept - receiver accepts transfer
    Accept {
        session_id: String,
    },
    /// Decline - receiver declines
    Decline {
        session_id: String,
        reason: Option<String>,
    },
    /// BlobTicket - sender sends iroh blob ticket for data transfer
    BlobTicket {
        session_id: String,
        ticket: String,
    },
    /// Cancel - either side cancels
    Cancel {
        session_id: String,
        reason: Option<String>,
    },
}

/// File information in manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
}

/// Transfer manifest containing file list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferManifest {
    pub files: Vec<FileInfo>,
    pub total_size: u64,
}

impl TransferManifest {
    pub fn new(files: Vec<FileInfo>) -> Self {
        let total_size = files.iter().map(|f| f.size).sum();
        Self { files, total_size }
    }
}
```

- [ ] **Step 2: Create lib/src/nearby/mod.rs**

```rust
//! Nearby device discovery and transfer
//!
//! Provides P2P file transfer between devices on the same network.

pub mod protocol;
pub mod sender;
pub mod receiver;
pub mod transfer;

pub use protocol::{ALPN, Message, FileInfo, TransferManifest};
pub use sender::NearbySender;
pub use receiver::NearbyReceiver;
pub use transfer::{TransferSession, TransferConfig};
```

- [ ] **Step 3: Update lib/src/nearby.rs to be module directory**

Move current content to `lib/src/nearby/core.rs` and update `lib/src/nearby/mod.rs` to re-export.

- [ ] **Step 4: Build to verify**

Run: `cargo build -p sendme-lib`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add lib/src/nearby/
git commit -m "feat(nearby): Add protocol messages and types"
```

---

## Chunk 2: Sender Implementation

**Files:**
- Create: `lib/src/nearby/sender.rs`
- Modify: `lib/src/nearby/mod.rs`

- [ ] **Step 1: Create lib/src/nearby/sender.rs**

```rust
//! Sender implementation for nearby transfer

use anyhow::{Context, Result};
use iroh::{Endpoint, RelayMode};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, RwLock};

use crate::nearby::protocol::{ALPN, Message, FileInfo, TransferManifest};

/// Events emitted by sender
#[derive(Debug, Clone)]
pub enum SenderEvent {
    WaitingForDecision { receiver_name: String },
    Transferring { bytes_sent: u64, total: u64 },
    Completed,
    Failed { reason: String },
    Cancelled,
}

/// Sender for nearby transfer
pub struct NearbySender {
    secret_key: iroh::SecretKey,
    endpoint: Option<Endpoint>,
}

impl NearbySender {
    pub fn new(secret_key: iroh::SecretKey) -> Self {
        Self {
            secret_key,
            endpoint: None,
        }
    }

    /// Initialize the iroh endpoint
    pub async fn initialize(&mut self) -> Result<()> {
        let endpoint = Endpoint::builder()
            .secret_key(self.secret_key.clone())
            .relay_mode(RelayMode::Disabled)  // Direct connection only
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .context("Failed to create endpoint")?;
        
        self.endpoint = Some(endpoint);
        Ok(())
    }

    /// Get our endpoint ID
    pub fn endpoint_id(&self) -> Option<String> {
        self.endpoint.as_ref().map(|ep| ep.node_id().to_string())
    }

    /// Connect to a peer and send files
    pub async fn send(
        &self,
        peer_addr: String,
        files: Vec<FileInfo>,
        event_tx: mpsc::Sender<SenderEvent>,
    ) -> Result<()> {
        let endpoint = self.endpoint.as_ref().context("Endpoint not initialized")?;
        
        // Parse peer address (format: "node_id@ip:port")
        let (peer_id, addr) = parse_peer_addr(&peer_addr)?;
        
        // Connect to peer
        let conn = endpoint.connect(peer_id, ALPN).await
            .context("Failed to connect to peer")?;
        
        // Open bi-directional stream
        let (mut send, mut recv) = conn.open_bi().await
            .context("Failed to open bi-stream")?;
        
        // Send Hello
        let hello = Message::Hello {
            device_name: hostname().unwrap_or_else(|| "Unknown".to_string()),
            device_type: "desktop".to_string(),  // TODO: detect device type
            endpoint_id: endpoint.node_id().to_string(),
        };
        write_message(&mut send, &hello).await?;
        
        // Receive peer Hello
        let _peer_hello: Message = read_message(&mut recv).await?;
        
        // Send Offer
        let manifest = TransferManifest::new(files);
        let offer = Message::Offer {
            files: manifest.files,
            total_size: manifest.total_size,
        };
        write_message(&mut send, &offer).await?;
        
        event_tx.send(SenderEvent::WaitingForDecision {
            receiver_name: "Peer".to_string(),  // TODO: get from response
        }).await?;
        
        // Wait for Accept/Decline
        let response: Message = read_message(&mut recv).await?;
        match response {
            Message::Accept { session_id } => {
                // Transfer files via iroh-blobs
                // (Implementation in Chunk 4)
                event_tx.send(SenderEvent::Transferring { bytes_sent: 0, total: manifest.total_size }).await?;
                event_tx.send(SenderEvent::Completed).await?;
            }
            Message::Decline { reason, .. } => {
                event_tx.send(SenderEvent::Failed {
                    reason: reason.unwrap_or_else(|| "Transfer declined".to_string())
                }).await?;
            }
            Message::Cancel { reason, .. } => {
                event_tx.send(SenderEvent::Cancelled).await?;
            }
            _ => {
                event_tx.send(SenderEvent::Failed { reason: "Unexpected message".to_string() }).await?;
            }
        }
        
        Ok(())
    }
}

fn parse_peer_addr(addr: &str) -> Result<(iroh::NodeId, iroh::EndpointAddr)> {
    let parts: Vec<&str> = addr.split('@').collect();
    if parts.len() != 2 {
        anyhow::bail!("Invalid peer address format, expected 'node_id@ip:port'");
    }
    let node_id: iroh::NodeId = parts[0].parse()
        .context("Invalid node ID")?;
    let endpoint_addr: iroh::EndpointAddr = parts[1].parse()
        .context("Invalid endpoint address")?;
    Ok((node_id, endpoint_addr))
}

pub fn hostname() -> Option<String> {
    std::env::var("HOSTNAME").ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            hostname::get()
                .ok()
                .and_then(|h| h.into_string().ok())
        })
}

async fn write_message(send: &mut (impl AsyncWriteExt + Unpin), msg: &Message) -> Result<()> {
    let data = bincode::serialize(msg)?;
    let len = data.len() as u32;
    send.write_u32(len).await?;
    send.write_all(&data).await?;
    send.flush().await?;
    Ok(())
}

async fn read_message(recv: &mut (impl AsyncReadExt + Unpin)) -> Result<Message> {
    let len = recv.read_u32().await?;
    let mut buf = vec![0u8; len as usize];
    recv.read_exact(&mut buf).await?;
    let msg: Message = bincode::deserialize(&buf)?;
    Ok(msg)
}
```

- [ ] **Step 2: Update mod.rs to export sender**

Add to `lib/src/nearby/mod.rs`:
```rust
pub use sender::NearbySender;
```

- [ ] **Step 3: Build to verify**

Run: `cargo build -p sendme-lib`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add lib/src/nearby/sender.rs lib/src/nearby/mod.rs
git commit -m "feat(nearby): Add sender implementation"
```

---

## Chunk 3: Receiver Implementation

**Files:**
- Create: `lib/src/nearby/receiver.rs`
- Modify: `lib/src/nearby/mod.rs`

- [ ] **Step 1: Create lib/src/nearby/receiver.rs**

```rust
//! Receiver implementation for nearby transfer

use anyhow::{Context, Result};
use iroh::{Endpoint, RelayMode};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, RwLock};

use crate::nearby::protocol::{ALPN, Message, FileInfo};

/// Events emitted by receiver
#[derive(Debug, Clone)]
pub enum ReceiverEvent {
    IncomingRequest {
        session_id: String,
        sender_name: String,
        files: Vec<FileInfo>,
        total_size: u64,
    },
    Transferring { bytes_received: u64, total: u64 },
    Completed { files_received: usize },
    Failed { reason: String },
    Cancelled,
}

/// Receiver for nearby transfer
pub struct NearbyReceiver {
    secret_key: iroh::SecretKey,
    endpoint: Option<Endpoint>,
    cancel_tx: Option<mpsc::Sender<()>>,
}

impl NearbyReceiver {
    pub fn new(secret_key: iroh::SecretKey) -> Self {
        Self {
            secret_key,
            endpoint: None,
            cancel_tx: None,
        }
    }

    /// Initialize the iroh endpoint
    pub async fn initialize(&mut self) -> Result<()> {
        let endpoint = Endpoint::builder()
            .secret_key(self.secret_key.clone())
            .relay_mode(RelayMode::Disabled)  // Direct connection only
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .context("Failed to create endpoint")?;
        
        self.endpoint = Some(endpoint);
        Ok(())
    }

    /// Get our endpoint ID
    pub fn endpoint_id(&self) -> Option<String> {
        self.endpoint.as_ref().map(|ep| ep.node_id().to_string())
    }

    /// Start listening for incoming transfers
    pub async fn listen(&mut self, event_tx: mpsc::Sender<ReceiverEvent>) -> Result<()> {
        let endpoint = self.endpoint.as_ref().context("Endpoint not initialized")?;
        let mut incoming = endpoint.accept().await?;
        
        let (cancel_tx, mut cancel_rx) = mpsc::channel(1);
        self.cancel_tx = Some(cancel_tx);
        
        loop {
            tokio::select! {
                biased;
                
                _ = cancel_rx.recv() => {
                    break;
                }
                
                incoming_conn = incoming => {
                    let conn = incoming?;
                    let event_tx = event_tx.clone();
                    
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(conn, event_tx).await {
                            eprintln!("Connection handler error: {}", e);
                        }
                    });
                }
            }
        }
        
        Ok(())
    }

    /// Accept an incoming transfer
    pub async fn accept(&self, session_id: &str) -> Result<()> {
        // This will be called when user accepts
        // The actual acceptance is handled via internal state
        Ok(())
    }

    /// Decline an incoming transfer
    pub async fn decline(&self, session_id: &str, reason: Option<String>) -> Result<()> {
        // This will be called when user declines
        Ok(())
    }

    /// Stop listening
    pub fn stop(&mut self) {
        if let Some(tx) = self.cancel_tx.take() {
            let _ = tx.try_send(());
        }
    }
}

async fn handle_connection(
    conn: iroh::Accepted,
    event_tx: mpsc::Sender<ReceiverEvent>,
) -> Result<()> {
    let (mut send, mut recv) = conn.conn.open_bi().await?;
    
    // Read sender's Hello
    let hello: Message = read_message(&mut recv).await?;
    let sender_name = if let Message::Hello { device_name, .. } = hello {
        device_name
    } else {
        return Err(anyhow::anyhow!("Expected Hello message"));
    };
    
    // Read Offer
    let offer: Message = read_message(&mut recv).await?;
    let (files, total_size, session_id) = if let Message::Offer { files, total_size } = offer {
        let session_id = uuid::Uuid::new_v4().to_string();
        (files, total_size, session_id)
    } else {
        return Err(anyhow::anyhow!("Expected Offer message"));
    };
    
    // Emit incoming request event
    event_tx.send(ReceiverEvent::IncomingRequest {
        session_id: session_id.clone(),
        sender_name,
        files: files.clone(),
        total_size,
    }).await?;
    
    // TODO: Wait for user decision (via shared state)
    // For now, auto-accept for testing
    let accept_msg = Message::Accept { session_id };
    write_message(&mut send, &accept_msg).await?;
    
    // Read BlobTicket
    let blob_ticket: Message = read_message(&mut recv).await?;
    if let Message::BlobTicket { ticket, .. } = blob_ticket {
        // TODO: Download via iroh-blobs
        event_tx.send(ReceiverEvent::Completed { files_received: files.len() }).await?;
    }
    
    Ok(())
}

async fn write_message(send: &mut (impl AsyncWriteExt + Unpin), msg: &Message) -> Result<()> {
    let data = bincode::serialize(msg)?;
    let len = data.len() as u32;
    send.write_u32(len).await?;
    send.write_all(&data).await?;
    send.flush().await?;
    Ok(())
}

async fn read_message(recv: &mut (impl AsyncReadExt + Unpin)) -> Result<Message> {
    let len = recv.read_u32().await?;
    let mut buf = vec![0u8; len as usize];
    recv.read_exact(&mut buf).await?;
    let msg: Message = bincode::deserialize(&buf)?;
    Ok(msg)
}
```

- [ ] **Step 2: Update mod.rs to export receiver**

Add to `lib/src/nearby/mod.rs`:
```rust
pub use receiver::NearbyReceiver;
```

- [ ] **Step 3: Add bincode and uuid to Cargo.toml dependencies**

Run: `cargo add bincode uuid --package sendme-lib`

- [ ] **Step 4: Build to verify**

Run: `cargo build -p sendme-lib`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add lib/src/nearby/receiver.rs lib/src/nearby/mod.rs
git add lib/Cargo.toml
git commit -m "feat(nearby): Add receiver implementation"
```

---

## Chunk 4: Integration with Tauri Commands

**Files:**
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/bindings.ts`

- [ ] **Step 1: Update Tauri send_to_device command**

Replace placeholder with actual implementation:

```rust
#[tauri::command]
async fn send_to_device(
    app: AppHandle,
    transfers: tauri::State<'_, Transfers>,
    file_paths: Vec<String>,
    device_id: String,
) -> Result<String, String> {
    use crate::nearby::{NearbySender, FileInfo};
    
    let secret_key = get_or_create_secret(false)
        .map_err(|e| e.to_string())?;
    
    let mut sender = NearbySender::new(secret_key);
    sender.initialize().await.map_err(|e| e.to_string())?;
    
    // Import files
    let files: Vec<FileInfo> = file_paths
        .into_iter()
        .map(|path| {
            let metadata = std::fs::metadata(&path)
                .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
            Ok(FileInfo {
                path: path.clone(),
                size: metadata.len(),
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    // Create event channel
    let (tx, mut rx) = mpsc::channel(32);
    
    // Start transfer
    let device_addr = device_id;  // TODO: Get address from discovered device
    sender.send(device_addr, files, tx)
        .await
        .map_err(|e| e.to_string())?;
    
    // Handle events
    while let Some(event) = rx.recv().await {
        match event {
            SenderEvent::WaitingForDecision { .. } => {
                // Update UI
            }
            SenderEvent::Transferring { .. } => {
                // Update progress
            }
            SenderEvent::Completed => {
                return Ok("Transfer completed".to_string());
            }
            SenderEvent::Failed { reason } => {
                return Err(reason);
            }
            SenderEvent::Cancelled => {
                return Err("Transfer cancelled".to_string());
            }
        }
    }
    
    Ok("Transfer started".to_string())
}
```

- [ ] **Step 2: Update accept/decline commands**

```rust
#[tauri::command]
async fn accept_incoming(
    request_id: String,
) -> Result<(), String> {
    // TODO: Implement via shared state with receiver
    Ok(())
}

#[tauri::command]
async fn decline_incoming(
    request_id: String,
) -> Result<(), String> {
    // TODO: Implement via shared state with receiver
    Ok(())
}
```

- [ ] **Step 3: Build to verify**

Run: `cargo build -p app`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/lib.rs
git commit -m "feat(tauri): Wire up send_to_device implementation"
```

---

## Summary

| Chunk | Description | Files |
|-------|-------------|-------|
| 1 | Protocol messages & types | `lib/src/nearby/protocol.rs`, `mod.rs` |
| 2 | Sender implementation | `lib/src/nearby/sender.rs` |
| 3 | Receiver implementation | `lib/src/nearby/receiver.rs` |
| 4 | Tauri integration | `app/src-tauri/src/lib.rs` |

**Note:** Chunk 2 and 3 have TODO items for actual blob transfer - the current implementation handles the control channel but not the actual file data transfer via iroh-blobs. That will be implemented in a future iteration.
