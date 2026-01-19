//! Nearby device discovery and ticket exchange.
//!
//! This module implements a LocalSend-inspired nearby discovery system:
//! - UDP Multicast for device discovery (224.0.0.167:53317)
//! - HTTP API for device info and ticket exchange
//! - Integration with iroh P2P for file transfer
//!
//! ## Protocol Overview
//!
//! 1. Devices join the multicast group and broadcast announcements
//! 2. When a device is discovered, it's added to the device list
//! 3. Devices can exchange iroh tickets via HTTP API
//! 4. File transfer happens over iroh P2P connections

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{Any, CorsLayer};

/// Default port for nearby discovery (same as LocalSend)
pub const DEFAULT_NEARBY_PORT: u16 = 53317;

/// Multicast group address for device discovery
pub const MULTICAST_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);

/// Protocol version
pub const PROTOCOL_VERSION: &str = "1.0";

/// Device type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    #[default]
    Desktop,
    Mobile,
    Web,
    Headless,
    Server,
}

/// Multicast announcement message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MulticastMessage {
    /// Device alias/name
    pub alias: String,
    /// Protocol version
    pub version: String,
    /// Device model (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    /// Device type
    pub device_type: DeviceType,
    /// Device fingerprint (unique identifier)
    pub fingerprint: String,
    /// HTTP server port
    pub port: u16,
    /// Whether this is an announcement (vs response)
    pub announce: bool,
    /// Whether device supports download mode
    #[serde(default)]
    pub download: bool,
}

/// Information about a discovered nearby device
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyDevice {
    /// Unique device fingerprint
    pub fingerprint: String,
    /// Device alias/name
    pub alias: String,
    /// Device model
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    /// Device type
    pub device_type: DeviceType,
    /// Protocol version
    pub version: String,
    /// IP address of the device
    pub ip: String,
    /// HTTP server port
    pub port: u16,
    /// When this device was last seen (Unix timestamp ms)
    pub last_seen: i64,
    /// Whether device is available
    pub available: bool,
    /// Pending ticket from this device (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_ticket: Option<String>,
}

/// Device info response (for HTTP API)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub alias: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    pub device_type: DeviceType,
    pub fingerprint: String,
    pub download: bool,
}

/// Ticket send request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketRequest {
    /// Sender's device info
    pub info: DeviceInfo,
    /// The iroh ticket to send
    pub ticket: String,
    /// Optional message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Ticket send response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketResponse {
    /// Whether the ticket was accepted
    pub accepted: bool,
    /// Response message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Event types for nearby discovery
#[derive(Debug, Clone)]
pub enum NearbyEvent {
    /// A device was discovered
    DeviceDiscovered(NearbyDevice),
    /// A device was updated
    DeviceUpdated(NearbyDevice),
    /// A device expired/went offline
    DeviceExpired(String),
    /// A ticket was received
    TicketReceived {
        from: NearbyDevice,
        ticket: String,
        message: Option<String>,
    },
}

/// Shared state for the nearby discovery service
#[derive(Debug)]
pub struct NearbyState {
    /// Our device info
    pub device_info: DeviceInfo,
    /// Discovered devices (fingerprint -> device)
    pub devices: HashMap<String, NearbyDevice>,
    /// Whether the server is running
    pub server_running: bool,
    /// HTTP server port
    pub port: u16,
    /// Event sender
    pub event_tx: Option<mpsc::Sender<NearbyEvent>>,
    /// Auto-accept tickets
    pub auto_accept: bool,
}

impl NearbyState {
    fn new(device_info: DeviceInfo, port: u16) -> Self {
        Self {
            device_info,
            devices: HashMap::new(),
            server_running: false,
            port,
            event_tx: None,
            auto_accept: false,
        }
    }
}

/// Nearby discovery service
pub struct NearbyDiscovery {
    /// Shared state
    state: Arc<RwLock<NearbyState>>,
    /// UDP socket for multicast
    multicast_socket: Option<Arc<UdpSocket>>,
    /// Event receiver
    event_rx: mpsc::Receiver<NearbyEvent>,
    /// Shutdown signal sender
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl NearbyDiscovery {
    /// Create a new nearby discovery service
    pub async fn new(alias: String) -> Result<Self> {
        Self::new_with_options(alias, DEFAULT_NEARBY_PORT, DeviceType::Desktop).await
    }

    /// Create a new nearby discovery service with options
    pub async fn new_with_options(
        alias: String,
        port: u16,
        device_type: DeviceType,
    ) -> Result<Self> {
        let fingerprint = generate_fingerprint();

        let device_info = DeviceInfo {
            alias,
            version: PROTOCOL_VERSION.to_string(),
            device_model: get_device_model(),
            device_type,
            fingerprint,
            download: false,
        };

        let (event_tx, event_rx) = mpsc::channel(100);

        let mut state = NearbyState::new(device_info, port);
        state.event_tx = Some(event_tx);

        Ok(Self {
            state: Arc::new(RwLock::new(state)),
            multicast_socket: None,
            event_rx,
            shutdown_tx: None,
        })
    }

    /// Get our device fingerprint
    pub async fn fingerprint(&self) -> String {
        self.state.read().await.device_info.fingerprint.clone()
    }

    /// Get our device info
    pub async fn device_info(&self) -> DeviceInfo {
        self.state.read().await.device_info.clone()
    }

    /// Set auto-accept mode for incoming tickets
    pub async fn set_auto_accept(&self, auto_accept: bool) {
        self.state.write().await.auto_accept = auto_accept;
    }

    /// Start the nearby discovery service
    ///
    /// This starts:
    /// 1. UDP multicast listener for device discovery
    /// 2. HTTP server for device info and ticket exchange
    pub async fn start(&mut self) -> Result<u16> {
        let state = self.state.clone();
        let port = state.read().await.port;

        // Create multicast socket
        let socket = create_multicast_socket(port).await?;
        let socket = Arc::new(socket);
        self.multicast_socket = Some(socket.clone());

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);

        // Start multicast listener
        let state_clone = state.clone();
        let socket_clone = socket.clone();
        tokio::spawn(async move {
            multicast_listener(state_clone, socket_clone, &mut shutdown_rx).await;
        });

        // Start HTTP server
        let state_clone = state.clone();
        let http_port = start_http_server(state_clone, port).await?;

        // Update state
        {
            let mut state = state.write().await;
            state.server_running = true;
            state.port = http_port;
        }

        // Send initial announcement
        self.send_announcement().await?;

        tracing::info!("Nearby discovery started on port {}", http_port);
        Ok(http_port)
    }

    /// Stop the nearby discovery service
    pub async fn stop(&mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(()).await;
        }
        self.multicast_socket = None;
        self.state.write().await.server_running = false;
        tracing::info!("Nearby discovery stopped");
    }

    /// Send a multicast announcement
    pub async fn send_announcement(&self) -> Result<()> {
        let socket = self
            .multicast_socket
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Multicast socket not initialized"))?;

        let state = self.state.read().await;
        let msg = MulticastMessage {
            alias: state.device_info.alias.clone(),
            version: state.device_info.version.clone(),
            device_model: state.device_info.device_model.clone(),
            device_type: state.device_info.device_type,
            fingerprint: state.device_info.fingerprint.clone(),
            port: state.port,
            announce: true,
            download: state.device_info.download,
        };

        let data = serde_json::to_vec(&msg)?;
        let addr = SocketAddrV4::new(MULTICAST_GROUP, DEFAULT_NEARBY_PORT);

        socket.send_to(&data, addr).await?;
        tracing::debug!("Sent multicast announcement");

        Ok(())
    }

    /// Get the list of discovered devices
    pub async fn devices(&self) -> Vec<NearbyDevice> {
        self.state
            .read()
            .await
            .devices
            .values()
            .filter(|d| d.available)
            .cloned()
            .collect()
    }

    /// Get a specific device by fingerprint
    pub async fn get_device(&self, fingerprint: &str) -> Option<NearbyDevice> {
        self.state.read().await.devices.get(fingerprint).cloned()
    }

    /// Send a ticket to a nearby device
    pub async fn send_ticket(
        &self,
        device: &NearbyDevice,
        ticket: &str,
        message: Option<String>,
    ) -> Result<TicketResponse> {
        let device_info = self.state.read().await.device_info.clone();

        let request = TicketRequest {
            info: device_info,
            ticket: ticket.to_string(),
            message,
        };

        let url = format!("http://{}:{}/api/sendme/v1/ticket", device.ip, device.port);

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .json(&request)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .context("Failed to send ticket")?;

        if response.status().is_success() {
            let ticket_response: TicketResponse = response.json().await?;
            Ok(ticket_response)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Failed to send ticket: {} - {}", status, body)
        }
    }

    /// Poll for events (non-blocking)
    pub async fn poll_event(&mut self) -> Option<NearbyEvent> {
        self.event_rx.try_recv().ok()
    }

    /// Wait for the next event
    pub async fn next_event(&mut self) -> Option<NearbyEvent> {
        self.event_rx.recv().await
    }

    /// Refresh device list by sending announcement and cleaning expired
    pub async fn refresh(&self) -> Result<()> {
        // Send announcement to trigger responses
        self.send_announcement().await?;

        // Clean expired devices (older than 30 seconds)
        let now = chrono::Utc::now().timestamp_millis();
        let mut state = self.state.write().await;
        let expired: Vec<_> = state
            .devices
            .iter()
            .filter(|(_, d)| now - d.last_seen > 30_000)
            .map(|(k, _)| k.clone())
            .collect();

        for fingerprint in expired {
            if let Some(device) = state.devices.get_mut(&fingerprint) {
                device.available = false;
            }
        }

        Ok(())
    }
}

/// Create a UDP socket for multicast
async fn create_multicast_socket(port: u16) -> Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;

    // Allow address reuse
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;

    // Bind to the port
    let addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port);
    socket.bind(&addr.into())?;

    // Set non-blocking
    socket.set_nonblocking(true)?;

    // Convert to tokio socket
    let socket = UdpSocket::from_std(socket.into())?;

    // Join multicast group on all interfaces
    socket.join_multicast_v4(MULTICAST_GROUP, Ipv4Addr::UNSPECIFIED)?;

    // Set multicast TTL
    socket.set_multicast_ttl_v4(1)?;

    tracing::debug!("Created multicast socket on port {}", port);
    Ok(socket)
}

/// Listen for multicast messages
async fn multicast_listener(
    state: Arc<RwLock<NearbyState>>,
    socket: Arc<UdpSocket>,
    shutdown_rx: &mut mpsc::Receiver<()>,
) {
    let mut buf = vec![0u8; 4096];

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                tracing::debug!("Multicast listener shutting down");
                break;
            }
            result = socket.recv_from(&mut buf) => {
                match result {
                    Ok((len, addr)) => {
                        if let Err(e) = handle_multicast_message(&state, &buf[..len], addr, &socket).await {
                            tracing::warn!("Error handling multicast message: {}", e);
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            tracing::warn!("Multicast recv error: {}", e);
                        }
                    }
                }
            }
        }
    }
}

/// Handle a received multicast message
async fn handle_multicast_message(
    state: &Arc<RwLock<NearbyState>>,
    data: &[u8],
    addr: SocketAddr,
    socket: &UdpSocket,
) -> Result<()> {
    let msg: MulticastMessage = serde_json::from_slice(data)?;

    // Ignore our own messages
    {
        let state = state.read().await;
        if msg.fingerprint == state.device_info.fingerprint {
            return Ok(());
        }
    }

    let ip = match addr.ip() {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => ip.to_string(),
    };

    let now = chrono::Utc::now().timestamp_millis();

    let device = NearbyDevice {
        fingerprint: msg.fingerprint.clone(),
        alias: msg.alias.clone(),
        device_model: msg.device_model.clone(),
        device_type: msg.device_type,
        version: msg.version.clone(),
        ip,
        port: msg.port,
        last_seen: now,
        available: true,
        pending_ticket: None,
    };

    // Update device list and send event
    let event = {
        let mut state = state.write().await;
        let is_new = !state.devices.contains_key(&msg.fingerprint);
        state
            .devices
            .insert(msg.fingerprint.clone(), device.clone());

        if is_new {
            NearbyEvent::DeviceDiscovered(device.clone())
        } else {
            NearbyEvent::DeviceUpdated(device.clone())
        }
    };

    // Send event
    {
        let state = state.read().await;
        if let Some(tx) = &state.event_tx {
            let _ = tx.send(event).await;
        }
    }

    // If this is an announcement and our server is running, respond
    if msg.announce {
        let state = state.read().await;
        if state.server_running {
            let response = MulticastMessage {
                alias: state.device_info.alias.clone(),
                version: state.device_info.version.clone(),
                device_model: state.device_info.device_model.clone(),
                device_type: state.device_info.device_type,
                fingerprint: state.device_info.fingerprint.clone(),
                port: state.port,
                announce: false,
                download: state.device_info.download,
            };

            let data = serde_json::to_vec(&response)?;
            socket.send_to(&data, addr).await?;
            tracing::debug!("Sent multicast response to {}", addr);
        }
    }

    tracing::info!(
        "Discovered device: {} ({}) at {}:{}",
        device.alias,
        device.fingerprint,
        device.ip,
        device.port
    );

    Ok(())
}

/// Start the HTTP server for device info and ticket exchange
async fn start_http_server(state: Arc<RwLock<NearbyState>>, preferred_port: u16) -> Result<u16> {
    let app = Router::new()
        .route("/api/sendme/v1/info", get(handle_info))
        .route("/api/sendme/v1/ticket", post(handle_ticket))
        .route("/api/sendme/v1/register", post(handle_register))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any))
        .with_state(state);

    // Try to bind to preferred port, fallback to any available
    let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{}", preferred_port)).await
    {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("0.0.0.0:0").await?,
    };

    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("HTTP server error: {}", e);
        }
    });

    tracing::info!("HTTP server started on port {}", port);
    Ok(port)
}

/// HTTP handler: Get device info
async fn handle_info(
    State(state): State<Arc<RwLock<NearbyState>>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<DeviceInfo> {
    let state = state.read().await;

    // If fingerprint is provided, we can verify it's not ourselves
    if let Some(fp) = params.get("fingerprint") {
        if fp == &state.device_info.fingerprint {
            tracing::debug!("Ignoring info request from ourselves");
        }
    }

    Json(state.device_info.clone())
}

/// HTTP handler: Receive a ticket
async fn handle_ticket(
    State(state): State<Arc<RwLock<NearbyState>>>,
    Json(request): Json<TicketRequest>,
) -> Result<Json<TicketResponse>, StatusCode> {
    tracing::info!(
        "Received ticket from {} ({})",
        request.info.alias,
        request.info.fingerprint
    );

    let auto_accept = state.read().await.auto_accept;

    // Update device info if we know about this device
    {
        let mut state = state.write().await;
        if let Some(device) = state.devices.get_mut(&request.info.fingerprint) {
            device.pending_ticket = Some(request.ticket.clone());
            device.last_seen = chrono::Utc::now().timestamp_millis();
        } else {
            // Add as new device (we learned about it through the ticket request)
            let device = NearbyDevice {
                fingerprint: request.info.fingerprint.clone(),
                alias: request.info.alias.clone(),
                device_model: request.info.device_model.clone(),
                device_type: request.info.device_type,
                version: request.info.version.clone(),
                ip: String::new(), // We don't know the IP from here
                port: 0,
                last_seen: chrono::Utc::now().timestamp_millis(),
                available: true,
                pending_ticket: Some(request.ticket.clone()),
            };
            state
                .devices
                .insert(request.info.fingerprint.clone(), device);
        }
    }

    // Send event
    {
        let state = state.read().await;
        if let Some(tx) = &state.event_tx {
            let device = state
                .devices
                .get(&request.info.fingerprint)
                .cloned()
                .unwrap_or_else(|| NearbyDevice {
                    fingerprint: request.info.fingerprint.clone(),
                    alias: request.info.alias.clone(),
                    device_model: request.info.device_model.clone(),
                    device_type: request.info.device_type,
                    version: request.info.version.clone(),
                    ip: String::new(),
                    port: 0,
                    last_seen: chrono::Utc::now().timestamp_millis(),
                    available: true,
                    pending_ticket: Some(request.ticket.clone()),
                });

            let _ = tx
                .send(NearbyEvent::TicketReceived {
                    from: device,
                    ticket: request.ticket.clone(),
                    message: request.message.clone(),
                })
                .await;
        }
    }

    let response = TicketResponse {
        accepted: auto_accept,
        message: if auto_accept {
            Some("Ticket accepted".to_string())
        } else {
            Some("Ticket pending approval".to_string())
        },
    };

    Ok(Json(response))
}

/// HTTP handler: Register device (response to announcement)
async fn handle_register(
    State(state): State<Arc<RwLock<NearbyState>>>,
    Json(info): Json<DeviceInfo>,
) -> StatusCode {
    tracing::debug!(
        "Received register from {} ({})",
        info.alias,
        info.fingerprint
    );

    // This would update our device list, but we handle this via multicast
    // This endpoint exists for compatibility with LocalSend protocol

    let _ = state; // Acknowledge state usage
    let _ = info;

    StatusCode::OK
}

/// Generate a unique device fingerprint
fn generate_fingerprint() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Get device model string
fn get_device_model() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Some("macOS".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Some("Windows".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        Some("Linux".to_string())
    }
    #[cfg(target_os = "ios")]
    {
        Some("iOS".to_string())
    }
    #[cfg(target_os = "android")]
    {
        Some("Android".to_string())
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux",
        target_os = "ios",
        target_os = "android"
    )))]
    {
        None
    }
}

/// Get the local IP address
pub fn get_local_ip() -> Option<String> {
    local_ip_address::local_ip().ok().map(|ip| ip.to_string())
}

/// Get the system hostname
pub fn get_hostname() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "Sendme Device".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_discovery() {
        let discovery = NearbyDiscovery::new("Test Device".to_string()).await;
        assert!(discovery.is_ok());
    }

    #[tokio::test]
    async fn test_fingerprint_unique() {
        let fp1 = generate_fingerprint();
        let fp2 = generate_fingerprint();
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn test_multicast_message_serialize() {
        let msg = MulticastMessage {
            alias: "Test".to_string(),
            version: "1.0".to_string(),
            device_model: Some("macOS".to_string()),
            device_type: DeviceType::Desktop,
            fingerprint: "test-fp".to_string(),
            port: 53317,
            announce: true,
            download: false,
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: MulticastMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.alias, msg.alias);
        assert_eq!(parsed.fingerprint, msg.fingerprint);
    }
}
