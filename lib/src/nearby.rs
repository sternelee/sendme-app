//! Nearby device discovery using mDNS.
//!
//! This module provides functionality for discovering nearby sendme devices
//! on the local network using iroh's mDNS discovery service.

use anyhow::Result;
use iroh::{
    discovery::mdns::{DiscoveryEvent, MdnsDiscovery},
    Endpoint, RelayMode,
};
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Information about a discovered nearby device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyDevice {
    /// The node ID of the discovered device.
    pub node_id: String,
    /// Optional device name/hostname if provided via mDNS user data.
    pub name: Option<String>,
    /// List of direct addresses for this device.
    pub addresses: Vec<String>,
    /// When this device was last seen (Unix timestamp).
    pub last_seen: i64,
    /// Whether this device is currently available.
    pub available: bool,
}

/// Manager for nearby device discovery.
pub struct NearbyDiscovery {
    /// The iroh endpoint used for discovery.
    endpoint: Endpoint,
    /// The mDNS discovery service.
    mdns: MdnsDiscovery,
    /// Known nearby devices.
    devices: Vec<NearbyDevice>,
}

impl NearbyDiscovery {
    /// Create a new nearby discovery manager with a custom hostname.
    ///
    /// This will create an endpoint with relays disabled (local-only mode)
    /// and register an mDNS discovery service that broadcasts the hostname.
    pub async fn new_with_hostname(hostname: String) -> Result<Self> {
        // Create endpoint with relay disabled for local-only discovery
        let endpoint = Endpoint::builder()
            .relay_mode(RelayMode::Disabled)
            .user_data_for_discovery(hostname.parse()?)
            .bind()
            .await?;

        // Create and register mDNS discovery
        let mdns = MdnsDiscovery::builder().build(endpoint.id())?;
        endpoint.discovery().add(mdns.clone());

        Ok(Self {
            endpoint,
            mdns,
            devices: Vec::new(),
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

    /// Get the node ID of this device.
    pub fn node_id(&self) -> iroh::EndpointId {
        self.endpoint.id()
    }

    /// Get a reference to the endpoint.
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
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
                            tracing::info!("Discovered nearby device: {}", node_id);

                            // Extract hostname from user data if available
                            let hostname = endpoint_info
                                .data
                                .user_data()
                                .map(|ud| ud.to_string());

                            let addresses = endpoint_info
                                .data
                                .addrs()
                                .map(|addr| format!("{:?}", addr))
                                .collect::<Vec<_>>();

                            let device = NearbyDevice {
                                node_id: node_id.to_string(),
                                name: hostname,
                                addresses,
                                last_seen: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)?
                                    .as_secs() as i64,
                                available: true,
                            };

                            // Add or update device in list
                            if let Some(existing) = self.devices.iter_mut().find(|d| d.node_id == device.node_id) {
                                *existing = device;
                            } else {
                                self.devices.push(device);
                            }
                        }
                        Some(DiscoveryEvent::Expired { endpoint_id }) => {
                            tracing::info!("Nearby device expired: {}", endpoint_id);
                            // Mark device as unavailable
                            if let Some(device) = self.devices.iter_mut().find(|d| d.node_id == endpoint_id.to_string()) {
                                device.available = false;
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

    /// Get devices discovered within a certain time window.
    pub fn recent_devices(&self, duration: Duration) -> Vec<NearbyDevice> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.devices
            .iter()
            .filter(|d| d.available && (now - d.last_seen) < duration.as_secs() as i64)
            .cloned()
            .collect()
    }

    /// Create a ticket for direct connection to a nearby device.
    ///
    /// This creates a ticket with only direct addresses (no relay) optimized
    /// for local network transfers.
    pub fn create_nearby_ticket(&self, hash: iroh_blobs::Hash) -> iroh_blobs::ticket::BlobTicket {
        use iroh_blobs::BlobFormat;

        let mut addr = self.endpoint.addr();
        // Filter to only include direct addresses
        addr.addrs = addr
            .addrs
            .into_iter()
            .filter(|addr| matches!(addr, iroh::TransportAddr::Ip(_)))
            .collect();

        iroh_blobs::ticket::BlobTicket::new(addr, hash, BlobFormat::HashSeq)
    }
}
