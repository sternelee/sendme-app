//! Nearby device discovery using mDNS.
//!
//! This module provides functionality for discovering nearby sendme devices
//! on the local network using iroh's mDNS discovery service with enhanced
//! device information and connectivity verification.

use anyhow::Result;
use iroh::{
    discovery::mdns::{DiscoveryEvent, MdnsDiscovery},
    Endpoint, RelayMode,
};
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::{io::AsyncWriteExt, net::TcpStream};

/// Information about a discovered nearby device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyDevice {
    /// The node ID of the discovered device.
    pub node_id: String,
    /// Optional device name/hostname if provided via mDNS user data.
    pub name: Option<String>,
    /// Display name for the device (hostname or fallback).
    pub display_name: String,
    /// List of direct addresses for this device.
    pub addresses: Vec<String>,
    /// List of IP addresses (extracted from addresses).
    pub ip_addresses: Vec<String>,
    /// When this device was last seen (Unix timestamp).
    pub last_seen: i64,
    /// Whether this device is currently available.
    pub available: bool,
    /// Whether this device is reachable via TCP.
    pub reachable: bool,
}

/// Manager for nearby device discovery.
pub struct NearbyDiscovery {
    /// The iroh endpoint used for discovery.
    endpoint: Endpoint,
    /// The mDNS discovery service.
    mdns: MdnsDiscovery,
    /// Known nearby devices.
    devices: Vec<NearbyDevice>,
    /// Default port for nearby connections (like rquickshare).
    nearby_port: u16,
}

impl NearbyDiscovery {
    /// Create a new nearby discovery manager with a custom hostname.
    ///
    /// This will create an endpoint with relays disabled (local-only mode)
    /// and register an mDNS discovery service that broadcasts the hostname.
    pub async fn new_with_hostname(hostname: String) -> Result<Self> {
        tracing::info!("🔍 Creating nearby discovery with hostname: {}", hostname);

        // Create endpoint with relay disabled for local-only discovery
        let endpoint = Endpoint::builder()
            .relay_mode(RelayMode::Disabled)
            .user_data_for_discovery(hostname.parse()?)
            .bind()
            .await?;
        tracing::info!("🔍 Endpoint created with node ID: {}", endpoint.id());

        // Create and register mDNS discovery
        let mdns = MdnsDiscovery::builder().build(endpoint.id())?;
        endpoint.discovery().add(mdns.clone());
        tracing::info!("🔍 mDNS discovery service registered");

        Ok(Self {
            endpoint,
            mdns,
            devices: Vec::new(),
            nearby_port: 0, // Will be set when starting the TCP server
        })
    }

    /// Create a new nearby discovery manager with default hostname.
    ///
    /// This will use the system hostname if available, or a default name.
    pub async fn new() -> Result<Self> {
        let hostname = Self::get_system_hostname()?;
        Self::new_with_hostname(hostname).await
    }

    /// Get the system hostname.
    fn get_system_hostname() -> Result<String> {
        // Try to get hostname from system
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .or_else(|_| {
                // Try to run hostname command
                std::process::Command::new("hostname")
                    .output()
                    .ok()
                    .and_then(|output| String::from_utf8(output.stdout).ok())
                    .map(|h| h.trim().to_string())
                    .ok_or_else(|| std::env::VarError::NotPresent)
            })
            .or_else(|_| Ok("Sendme Device".to_string()))
    }

    /// Set the nearby port for TCP connections.
    pub fn set_nearby_port(&mut self, port: u16) {
        self.nearby_port = port;
    }

    /// Get the node ID of this device.
    pub fn node_id(&self) -> iroh::EndpointId {
        self.endpoint.id()
    }

    /// Get a reference to the endpoint.
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Check if a device is reachable via TCP.
    async fn check_tcp_connectivity(&self, device: &NearbyDevice) -> bool {
        if self.nearby_port == 0 {
            tracing::warn!("🔍 TCP connectivity check failed: nearby port not set");
            return false;
        }

        if device.ip_addresses.is_empty() {
            tracing::warn!(
                "🔍 TCP connectivity check failed: no IP addresses for device {}",
                device.display_name
            );
            return false;
        }

        // Try to connect to each IP address
        for ip in &device.ip_addresses {
            let addr = format!("{}:{}", ip, self.nearby_port);
            tracing::debug!(
                "🔍 Attempting TCP connection to {} ({})",
                device.display_name,
                addr
            );

            match tokio::time::timeout(Duration::from_millis(1000), TcpStream::connect(&addr)).await
            {
                Ok(Ok(_)) => {
                    tracing::info!(
                        "✅ TCP connection successful to {} at {}",
                        device.display_name,
                        addr
                    );
                    return true;
                }
                Ok(Err(e)) => {
                    tracing::debug!(
                        "❌ TCP connection failed to {} at {}: {}",
                        device.display_name,
                        addr,
                        e
                    );
                }
                Err(_) => {
                    tracing::debug!(
                        "⏰ TCP connection timeout to {} at {}",
                        device.display_name,
                        addr
                    );
                }
            }
        }

        tracing::warn!(
            "🔍 TCP connectivity check failed for device {} - no reachable IPs",
            device.display_name
        );
        false
    }

    /// Poll for discovery events and update the device list.
    ///
    /// This will process pending discovery events and return immediately.
    pub async fn poll(&mut self) -> Result<()> {
        let mut events = self.mdns.subscribe().await;

        // Process events with a timeout
        let timeout = Duration::from_millis(100);

        loop {
            tokio::select! {
                event = events.next() => {
                    match event {
                        Some(DiscoveryEvent::Discovered { endpoint_info, .. }) => {
                            let node_id = endpoint_info.endpoint_id;
                            tracing::info!("🔍 Discovered nearby device: {}", node_id);

                            // Extract hostname from user data if available
                            let hostname = endpoint_info
                                .data
                                .user_data()
                                .map(|ud| ud.to_string());
                            tracing::debug!("🔍 Discovered device hostname: {:?}", hostname);

                            let addresses = endpoint_info
                                .data
                                .addrs()
                                .map(|addr| format!("{:?}", addr))
                                .collect::<Vec<_>>();
                            tracing::debug!("🔍 Discovered device addresses: {:?}", addresses);

                            // Extract IP addresses from addresses
                            let ip_addresses = endpoint_info
                                .data
                                .addrs()
                                .filter_map(|addr| match addr {
                                    iroh::TransportAddr::Ip(ip_addr) => Some(ip_addr.to_string()),
                                    _ => None,
                                })
                                .collect::<Vec<_>>();
                            tracing::debug!("🔍 Discovered device IP addresses: {:?}", ip_addresses);

                            // Create device info
                            let mut device = NearbyDevice {
                                node_id: node_id.to_string(),
                                name: hostname.clone(),
                                display_name: hostname.clone().unwrap_or_else(|| format!("Device-{}", hex::encode(&node_id[..4]))),
                                addresses,
                                ip_addresses,
                                last_seen: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)?
                                    .as_secs() as i64,
                                available: true,
                                reachable: false,
                            };

                            // Check TCP connectivity
                            tracing::debug!("🔍 Checking TCP connectivity for device {}", device.display_name);
                            device.reachable = self.check_tcp_connectivity(&device).await;
                            tracing::info!("🔍 Device {} is reachable: {}", device.display_name, device.reachable);

                            // Add or update device in list
                            if let Some(existing) = self.devices.iter_mut().find(|d| d.node_id == device.node_id) {
                                *existing = device;
                            } else {
                                self.devices.push(device);
                            }
                        }
                        Some(DiscoveryEvent::Expired { endpoint_id }) => {
                            tracing::info!("⏰ Nearby device expired: {}", endpoint_id);
                            // Mark device as unavailable
                            if let Some(device) = self.devices.iter_mut().find(|d| d.node_id == endpoint_id.to_string()) {
                                device.available = false;
                                device.reachable = false;
                            }
                        }
                        None => break,
                    }
                }
                _ = tokio::time::sleep(timeout) => {
                    // Timeout, stop polling
                    break;
                }
            }
        }

        Ok(())
    }

    /// Get the current list of nearby devices.
    pub fn devices(&self) -> &[NearbyDevice] {
        &self.devices
    }

    /// Send a ticket to a nearby device.
    ///
    /// This establishes a TCP connection to the device and sends the ticket data.
    pub async fn send_ticket(&self, device: &NearbyDevice, ticket_data: &str) -> Result<()> {
        if !device.reachable || self.nearby_port == 0 {
            anyhow::bail!("Device is not reachable or nearby port not set");
        }

        // Find a reachable IP address
        let target_ip = device
            .ip_addresses
            .first()
            .ok_or_else(|| anyhow::anyhow!("No IP addresses available for device"))?;

        let addr = format!("{}:{}", target_ip, self.nearby_port);

        // Connect and send ticket
        let mut stream = TcpStream::connect(&addr).await?;

        // Send ticket data with a simple protocol:
        // Length (4 bytes, big endian) + "TICKET" + ticket data
        let protocol_header = b"TICKET";
        let ticket_bytes = ticket_data.as_bytes();
        let total_len = (protocol_header.len() + ticket_bytes.len()) as u32;

        // Send length
        stream.write_all(&total_len.to_be_bytes()).await?;
        // Send protocol header
        stream.write_all(protocol_header).await?;
        // Send ticket data
        stream.write_all(ticket_bytes).await?;

        stream.flush().await?;
        tracing::info!("Sent ticket to device {} at {}", device.display_name, addr);

        Ok(())
    }

    /// Get devices that are reachable via TCP.
    pub fn reachable_devices(&self) -> Vec<NearbyDevice> {
        self.devices
            .iter()
            .filter(|d| d.available && d.reachable)
            .cloned()
            .collect()
    }

    /// Start a TCP server for receiving tickets from nearby devices.
    ///
    /// Returns the port the server is listening on.
    pub async fn start_ticket_server(&mut self) -> Result<u16> {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("0.0.0.0:0").await?;
        let port = listener.local_addr()?.port();
        self.nearby_port = port;

        tracing::info!("Nearby ticket server listening on port {}", port);

        // Note: In a real implementation, you'd want to spawn this as a task
        // and handle incoming connections. For now, we just return the port.

        Ok(port)
    }

    /// Receive a ticket from a nearby device (blocking call for testing).
    ///
    /// In a real implementation, this would be handled asynchronously.
    pub async fn receive_ticket(&self) -> Result<String> {
        use tokio::io::AsyncReadExt;
        use tokio::net::TcpListener;

        if self.nearby_port == 0 {
            anyhow::bail!("Nearby server not started");
        }

        let listener = TcpListener::bind(format!("0.0.0.0:{}", self.nearby_port)).await?;

        loop {
            let (mut socket, _) = listener.accept().await?;

            // Read length
            let mut len_buf = [0u8; 4];
            socket.read_exact(&mut len_buf).await?;
            let total_len = u32::from_be_bytes(len_buf) as usize;

            // Read protocol header
            let mut header_buf = [0u8; 6]; // "TICKET" is 6 bytes
            socket.read_exact(&mut header_buf).await?;
            let header = std::str::from_utf8(&header_buf)?;

            if header != "TICKET" {
                continue; // Not a ticket message
            }

            // Read ticket data
            let ticket_len = total_len - header.len();
            let mut ticket_buf = vec![0u8; ticket_len];
            socket.read_exact(&mut ticket_buf).await?;

            let ticket = String::from_utf8(ticket_buf)?;
            tracing::info!("Received ticket: {}", ticket);

            return Ok(ticket);
        }
    }
}
