//! Sender implementation for nearby transfer

use anyhow::{Context, Result};
use iroh::{endpoint::{Connection, presets::N0}, Endpoint, EndpointAddr};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::nearby::protocol::{FileInfo, Message, TransferManifest, ALPN};

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
        let endpoint = Endpoint::builder(N0)
            .secret_key(self.secret_key.clone())
            .relay_mode(iroh::RelayMode::Disabled)
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .context("Failed to create endpoint")?;

        self.endpoint = Some(endpoint);
        Ok(())
    }

    /// Get our endpoint ID
    pub fn endpoint_id(&self) -> Option<String> {
        self.endpoint
            .as_ref()
            .map(|_ep| self.secret_key.public().to_string())
    }

    /// Get the endpoint
    pub fn get_endpoint(&self) -> Option<&Endpoint> {
        self.endpoint.as_ref()
    }

    /// Connect to a peer and send files
    pub async fn send(
        &self,
        peer_id: iroh::EndpointId,
        files: Vec<FileInfo>,
        event_tx: mpsc::Sender<SenderEvent>,
    ) -> Result<()> {
        let endpoint = self.endpoint.as_ref().context("Endpoint not initialized")?;

        let addr = EndpointAddr::from_parts(peer_id, vec![]);
        let conn: Connection = endpoint
            .connect(addr, ALPN)
            .await
            .context("Failed to connect to peer")?;

        let (mut send, mut recv) = conn.open_bi().await.context("Failed to open bi-stream")?;

        // Send Hello
        let hello = Message::Hello {
            device_name: get_hostname().unwrap_or_else(|| "Unknown".to_string()),
            device_type: "desktop".to_string(),
            endpoint_id: self.secret_key.public().to_string(),
        };
        write_message(&mut send, &hello).await?;

        // Receive peer Hello
        let peer_hello: Message = read_message(&mut recv).await?;
        let peer_name = if let Message::Hello {
            ref device_name, ..
        } = peer_hello
        {
            device_name.clone()
        } else {
            "Unknown".to_string()
        };

        // Send Offer with file manifest
        let manifest = TransferManifest::new(files);
        let offer = Message::Offer {
            files: manifest.files,
            total_size: manifest.total_size,
        };
        write_message(&mut send, &offer).await?;

        event_tx
            .send(SenderEvent::WaitingForDecision {
                receiver_name: peer_name,
            })
            .await?;

        // Wait for Accept/Decline
        let response: Message = read_message(&mut recv).await?;
        match response {
            Message::Accept { session_id: _ } => {
                // TODO: Send blob ticket for actual file transfer
                // For now, just signal completion
                event_tx
                    .send(SenderEvent::Transferring {
                        bytes_sent: manifest.total_size,
                        total: manifest.total_size,
                    })
                    .await?;
                event_tx.send(SenderEvent::Completed).await?;
            }
            Message::Decline { reason, .. } => {
                event_tx
                    .send(SenderEvent::Failed {
                        reason: reason.unwrap_or_else(|| "Transfer declined".to_string()),
                    })
                    .await?;
            }
            Message::Cancel { reason: _, .. } => {
                event_tx.send(SenderEvent::Cancelled).await?;
            }
            _ => {
                event_tx
                    .send(SenderEvent::Failed {
                        reason: "Unexpected message".to_string(),
                    })
                    .await?;
            }
        }

        Ok(())
    }
}

fn get_hostname() -> Option<String> {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|s| !s.is_empty())
}

async fn write_message(send: &mut (impl AsyncWriteExt + Unpin), msg: &Message) -> Result<()> {
    let data = serde_json::to_vec(msg)?;
    let len = data.len() as u32;
    send.write_u32(len).await?;
    send.write_all(&data).await?;
    send.flush().await?;
    Ok(())
}

async fn read_message(recv: &mut (impl AsyncReadExt + Unpin)) -> Result<Message> {
    let mut len_buf = [0u8; 4];
    recv.read_exact(&mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await?;
    let msg: Message = serde_json::from_slice(&buf)?;
    Ok(msg)
}
