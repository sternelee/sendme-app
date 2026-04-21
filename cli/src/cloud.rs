//! Cloud API HTTP client for sendme CLI.
//!
//! Wraps all cloud API calls and WebSocket listener for the sendme browser backend.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub struct CloudClient {
    client: Client,
    base_url: String,
    api_key: String,
    device_id: String,
}

// --- Response types ---

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
    #[serde(rename = "device_id")]
    pub device_id: Option<String>,
    pub online: Option<bool>,
    pub hostname: Option<String>,
    #[serde(rename = "last_seen_at")]
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Friend {
    pub id: String,
    #[serde(rename = "friendUserId")]
    pub friend_user_id: Option<String>,
    pub status: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub image: Option<String>,
    pub devices: Option<Vec<Device>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Ticket {
    pub id: String,
    pub ticket: String,
    pub filename: Option<String>,
    #[serde(rename = "file_size")]
    pub file_size: Option<i64>,
    pub status: String,
    #[serde(rename = "from_device_id")]
    pub from_device_id: Option<String>,
    #[serde(rename = "to_device_id")]
    pub to_device_id: Option<String>,
}

/// Friend as pushed over WebSocket (richer than the REST Friend type).
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WsFriend {
    pub id: String,
    #[serde(rename = "userId", default)]
    pub user_id: Option<String>,
    #[serde(rename = "friendUserId", default)]
    pub friend_user_id: Option<String>,
    pub status: String,
    pub friend: Option<WsFriendInfo>,
    #[serde(rename = "friendDevices", default)]
    pub friend_devices: Vec<WsFriendDevice>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WsFriendInfo {
    pub id: String,
    pub name: String,
    pub email: String,
    pub image: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WsFriendDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub online: Option<bool>,
    #[serde(rename = "lastSeenAt", default)]
    pub last_seen_at: Option<String>,
}

/// Messages received from the cloud WebSocket.
#[derive(Debug, Clone)]
pub enum WsMessage {
    Connected,
    Disconnected,
    Devices(Vec<Device>),
    Friends(Vec<WsFriend>),
    Tickets(Vec<Ticket>),
    /// User-facing notification (e.g. "file downloaded by recipient").
    Notification(String),
    /// DB id assigned to this device after registration.
    DeviceRegistered(String),
}

#[derive(Debug, Serialize)]
struct RegisterDeviceBody {
    #[serde(rename = "deviceId")]
    device_id: String,
    name: String,
    hostname: Option<String>,
}

#[derive(Debug, Serialize)]
struct SendTicketBody {
    ticket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "deviceId")]
    to_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "friendUserId")]
    to_user_id: Option<String>,
    #[serde(rename = "fromDeviceId")]
    from_device_id: String,
}

impl CloudClient {
    pub fn new(base_url: String, api_key: String, device_id: String) -> Self {
        let client = Client::builder()
            .user_agent(concat!("sendme-cli/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self {
            client,
            base_url,
            api_key,
            device_id,
        }
    }

    fn auth_headers(&self) -> Vec<(&'static str, String)> {
        vec![
            ("Authorization", format!("Bearer {}", self.api_key)),
            ("X-Device-Id", self.device_id.clone()),
        ]
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Register this CLI as a device. Returns the device DB record.
    pub async fn register_device(&self, name: &str, hostname: Option<&str>) -> Result<Device> {
        let body = RegisterDeviceBody {
            device_id: self.device_id.clone(),
            name: name.to_string(),
            hostname: hostname.map(|s| s.to_string()),
        };
        let resp = self
            .client
            .post(self.url("/api/devices"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .json(&body)
            .send()
            .await
            .context("Failed to register device")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to register device ({}): {}", status, text);
        }

        resp.json().await.context("Failed to parse device response")
    }

    /// List all devices for the authenticated user.
    pub async fn list_devices(&self) -> Result<Vec<Device>> {
        let resp = self
            .client
            .get(self.url("/api/devices"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .send()
            .await
            .context("Failed to list devices")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to list devices ({}): {}", status, text);
        }

        resp.json()
            .await
            .context("Failed to parse devices response")
    }

    /// Send heartbeat for a device.
    pub async fn heartbeat(&self, device_db_id: &str) -> Result<()> {
        let resp = self
            .client
            .put(self.url(&format!("/api/devices/{}/heartbeat", device_db_id)))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .send()
            .await
            .context("Failed to send heartbeat")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Heartbeat failed ({}): {}", status, text);
        }
        Ok(())
    }

    /// List accepted friends.
    pub async fn list_friends(&self) -> Result<Vec<Friend>> {
        let resp = self
            .client
            .get(self.url("/api/friends?status=accepted"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .send()
            .await
            .context("Failed to list friends")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to list friends ({}): {}", status, text);
        }

        resp.json()
            .await
            .context("Failed to parse friends response")
    }

    /// Push a ticket to a specific device.
    pub async fn send_ticket_to_device(
        &self,
        device_db_id: &str,
        from_device_db_id: &str,
        ticket: &str,
        filename: Option<&str>,
    ) -> Result<()> {
        let body = SendTicketBody {
            ticket: ticket.to_string(),
            filename: filename.map(|s| s.to_string()),
            to_device_id: Some(device_db_id.to_string()),
            to_user_id: None,
            from_device_id: from_device_db_id.to_string(),
        };
        self.post_ticket(&body).await
    }

    /// Push a ticket to a friend (all their online devices).
    pub async fn send_ticket_to_friend(
        &self,
        friend_user_id: &str,
        from_device_db_id: &str,
        ticket: &str,
        filename: Option<&str>,
    ) -> Result<()> {
        let body = SendTicketBody {
            ticket: ticket.to_string(),
            filename: filename.map(|s| s.to_string()),
            to_device_id: None,
            to_user_id: Some(friend_user_id.to_string()),
            from_device_id: from_device_db_id.to_string(),
        };
        self.post_ticket(&body).await
    }

    /// Get pending tickets for this device.
    pub async fn get_pending_tickets(&self) -> Result<Vec<Ticket>> {
        let resp = self
            .client
            .get(self.url("/api/tickets"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .send()
            .await
            .context("Failed to get tickets")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get tickets ({}): {}", status, text);
        }

        resp.json()
            .await
            .context("Failed to parse tickets response")
    }

    async fn post_ticket(&self, body: &SendTicketBody) -> Result<()> {
        let resp = self
            .client
            .post(self.url("/api/tickets"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .json(body)
            .send()
            .await
            .context("Failed to send ticket")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to send ticket ({}): {}", status, text);
        }
        Ok(())
    }

    /// Mark an incoming ticket as received (removes it from the pending queue).
    pub async fn mark_ticket_received(&self, ticket_id: &str) -> Result<()> {
        let resp = self
            .client
            .post(self.url(&format!("/api/tickets/{}/receive", ticket_id)))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .send()
            .await
            .context("Failed to mark ticket received")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to mark ticket received ({}): {}", status, text);
        }
        Ok(())
    }

    /// Delete a pending ticket by its ticket string.
    pub async fn delete_ticket(&self, ticket_str: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            ticket: &'a str,
        }
        let resp = self
            .client
            .delete(self.url("/api/tickets"))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-Device-Id", &self.device_id)
            .header("Content-Type", "application/json")
            .json(&Body { ticket: ticket_str })
            .send()
            .await
            .context("Failed to delete ticket")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to delete ticket ({}): {}", status, text);
        }
        Ok(())
    }
}

/// Run a persistent WebSocket connection that forwards server messages to `tx`.
///
/// Reconnects automatically with exponential backoff.  Never returns unless the
/// channel is closed.
pub async fn run_ws_loop(
    base_url: String,
    api_key: String,
    device_id: String,
    tx: tokio::sync::mpsc::Sender<WsMessage>,
) {
    // Convert http(s) to ws(s)
    let ws_base = base_url
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let ws_url = format!(
        "{}/api/ws?deviceId={}&token={}",
        ws_base, device_id, api_key
    );

    let mut backoff_ms: u64 = 1_000;
    const MAX_BACKOFF_MS: u64 = 30_000;

    loop {
        if tx.is_closed() {
            break;
        }

        match connect_and_run_ws(&ws_url, &api_key, &tx).await {
            Ok(_) => {}
            Err(e) => {
                tracing::debug!("[WS] connection error: {}", e);
            }
        }

        let _ = tx.send(WsMessage::Disconnected).await;

        if tx.is_closed() {
            break;
        }

        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
    }
}

async fn connect_and_run_ws(
    url: &str,
    _api_key: &str,
    tx: &tokio::sync::mpsc::Sender<WsMessage>,
) -> Result<()> {
    let (ws_stream, _) = tokio_tungstenite::connect_async(url)
        .await
        .context("WebSocket connect failed")?;

    let _ = tx.send(WsMessage::Connected).await;

    let (mut write, mut read) = ws_stream.split();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                write
                    .send(Message::Text(r#"{"type":"heartbeat"}"#.to_string().into()))
                    .await
                    .context("heartbeat send failed")?;
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(event) = parse_ws_text(&text) {
                            if tx.send(event).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => return Err(e.into()),
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn parse_ws_text(text: &str) -> Option<WsMessage> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;
    match val["type"].as_str()? {
        "devices" => {
            let devices: Vec<Device> = serde_json::from_value(val["data"].clone()).ok()?;
            Some(WsMessage::Devices(devices))
        }
        "tickets" => {
            let tickets: Vec<Ticket> = serde_json::from_value(val["data"].clone()).ok()?;
            Some(WsMessage::Tickets(tickets))
        }
        "friends" => {
            let friends: Vec<WsFriend> = serde_json::from_value(val["data"].clone()).ok()?;
            Some(WsMessage::Friends(friends))
        }
        "transfer_received" => {
            let filename = val["data"]["filename"].as_str().map(|s| s.to_string());
            let msg = format!(
                "✓ {} was downloaded by the recipient",
                filename.as_deref().unwrap_or("file")
            );
            Some(WsMessage::Notification(msg))
        }
        "error" => {
            let msg = val["data"]
                .as_str()
                .unwrap_or("unknown server error")
                .to_string();
            Some(WsMessage::Notification(format!("Server error: {}", msg)))
        }
        _ => None,
    }
}
