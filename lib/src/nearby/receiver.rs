//! Receiver implementation for nearby transfer

use anyhow::{Context, Result};
use iroh::{
    endpoint::{presets::N0, Incoming},
    Endpoint,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, RwLock};

use crate::nearby::protocol::{FileInfo, Message, ALPN};

/// Events emitted by receiver
#[derive(Debug, Clone)]
pub enum ReceiverEvent {
    IncomingRequest {
        session_id: String,
        sender_name: String,
        sender_endpoint_id: String,
        files: Vec<FileInfo>,
        total_size: u64,
        /// Channel to send the decision
        response_tx: mpsc::Sender<ReceiverDecision>,
    },
    Transferring {
        bytes_received: u64,
        total: u64,
    },
    Completed {
        files_received: usize,
    },
    Failed {
        reason: String,
    },
    Cancelled,
}

/// User decision on incoming transfer
#[derive(Debug, Clone)]
pub enum ReceiverDecision {
    Accept,
    Decline { reason: Option<String> },
}

/// Receiver for nearby transfer
pub struct NearbyReceiver {
    secret_key: iroh::SecretKey,
    endpoint: Option<Endpoint>,
    active_sessions: Arc<RwLock<HashMap<String, SessionState>>>,
}

#[allow(dead_code)]
struct SessionState {
    sender_name: String,
    files: Vec<FileInfo>,
    total_size: u64,
    response_rx: Option<mpsc::Receiver<ReceiverDecision>>,
}

impl NearbyReceiver {
    pub fn new(secret_key: iroh::SecretKey) -> Self {
        Self {
            secret_key,
            endpoint: None,
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
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

    /// Start listening for incoming transfers
    pub async fn listen(&self, event_tx: mpsc::Sender<ReceiverEvent>) -> Result<()> {
        let endpoint = self.endpoint.as_ref().context("Endpoint not initialized")?;

        loop {
            match endpoint.accept().await {
                Some(incoming) => {
                    let event_tx = event_tx.clone();
                    let sessions = self.active_sessions.clone();

                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(incoming, event_tx, sessions).await {
                            eprintln!("Connection handler error: {}", e);
                        }
                    });
                }
                None => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }
}

async fn handle_connection(
    incoming: Incoming,
    event_tx: mpsc::Sender<ReceiverEvent>,
    sessions: Arc<RwLock<HashMap<String, SessionState>>>,
) -> Result<()> {
    let accepting = incoming.accept()?;
    let conn = accepting.await?;
    let (mut send, mut recv) = conn.accept_bi().await?;

    // Read Hello
    let hello: Message = read_message(&mut recv).await?;
    let (sender_name, sender_endpoint_id) = if let Message::Hello {
        device_name,
        endpoint_id,
        ..
    } = hello
    {
        (device_name, endpoint_id)
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

    // Create channel for decision
    let (response_tx, response_rx) = mpsc::channel(1);

    // Store session
    let session = SessionState {
        sender_name: sender_name.clone(),
        files: files.clone(),
        total_size,
        response_rx: Some(response_rx),
    };
    sessions.write().await.insert(session_id.clone(), session);

    // Emit incoming request event
    event_tx
        .send(ReceiverEvent::IncomingRequest {
            session_id: session_id.clone(),
            sender_name,
            sender_endpoint_id,
            files: files.clone(),
            total_size,
            response_tx,
        })
        .await?;

    // Wait for user decision
    let decision = if let Some(mut rx) = sessions
        .write()
        .await
        .get_mut(&session_id)
        .and_then(|s| s.response_rx.take())
    {
        rx.recv().await.unwrap_or(ReceiverDecision::Decline {
            reason: Some("timeout".to_string()),
        })
    } else {
        ReceiverDecision::Decline {
            reason: Some("session not found".to_string()),
        }
    };

    // Send response
    match decision {
        ReceiverDecision::Accept => {
            let msg = Message::Accept {
                session_id: session_id.clone(),
            };
            write_message(&mut send, &msg).await?;

            // Read any follow-up message (like BlobTicket)
            // TODO: Implement blob download when sender sends ticket
            event_tx
                .send(ReceiverEvent::Completed {
                    files_received: files.len(),
                })
                .await?;
        }
        ReceiverDecision::Decline { reason } => {
            let msg = Message::Decline {
                session_id: session_id.clone(),
                reason: reason.clone(),
            };
            write_message(&mut send, &msg).await?;
            event_tx
                .send(ReceiverEvent::Failed {
                    reason: reason.unwrap_or_else(|| "declined".to_string()),
                })
                .await?;
        }
    }

    // Cleanup session
    sessions.write().await.remove(&session_id);

    Ok(())
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
