//! Receiver implementation for nearby transfer

use anyhow::{Context, Result};
use iroh::{Endpoint, RelayMode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::nearby::protocol::{ALPN, Message, FileInfo};

/// Events emitted by receiver
#[derive(Debug, Clone)]
pub enum ReceiverEvent {
    IncomingRequest {
        session_id: String,
        sender_name: String,
        sender_endpoint_id: String,
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
}

impl NearbyReceiver {
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
            .relay_mode(RelayMode::Disabled)
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .context("Failed to create endpoint")?;

        self.endpoint = Some(endpoint);
        Ok(())
    }

    /// Get our endpoint ID
    pub fn endpoint_id(&self) -> Option<String> {
        self.endpoint.as_ref().map(|_ep| self.secret_key.public().to_string())
    }

    /// Get the endpoint for accept()
    pub fn get_endpoint(&self) -> Option<&Endpoint> {
        self.endpoint.as_ref()
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
