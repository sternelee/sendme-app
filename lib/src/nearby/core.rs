//! Nearby device discovery using mDNS
//!
//! Discovers other sendme instances on the local network using the `_iroh._tcp` service type.

use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NearbyDevice {
    pub id: String,
    pub name: String,
    pub device_type: DeviceType,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Phone,
    Tablet,
    Laptop,
    Desktop,
    Unknown,
}

impl From<&str> for DeviceType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "phone" | "mobile" => DeviceType::Phone,
            "tablet" => DeviceType::Tablet,
            "laptop" | "notebook" => DeviceType::Laptop,
            "desktop" => DeviceType::Desktop,
            _ => DeviceType::Unknown,
        }
    }
}

impl DeviceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeviceType::Phone => "phone",
            DeviceType::Tablet => "tablet",
            DeviceType::Laptop => "laptop",
            DeviceType::Desktop => "desktop",
            DeviceType::Unknown => "unknown",
        }
    }
}

pub const SERVICE_TYPE: &str = "_iroh._tcp";

struct ServiceEntry {
    name: String,
    device_type: DeviceType,
    addresses: Vec<String>,
}

pub struct NearbyDiscovery {
    services: Arc<Mutex<HashMap<String, ServiceEntry>>>,
    stop_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<()>>>>,
    our_instance_name: Option<String>,
}

impl NearbyDiscovery {
    pub fn new() -> Result<Self> {
        let services = Arc::new(Mutex::new(HashMap::new()));
        let stop_tx = Arc::new(Mutex::new(None));
        Ok(Self {
            services,
            stop_tx,
            our_instance_name: None,
        })
    }

    pub fn start(&mut self, name: &str, device_type: DeviceType, port: u16) -> Result<()> {
        let daemon = ServiceDaemon::new()?;
        let service_type = format!("{}.local.", SERVICE_TYPE);
        
        let instance_name = name.replace(" ", "-");
        let hostname = format!("{}.local.", instance_name);
        
        let properties = [
            ("type", device_type.as_str()),
        ];

        let service_info = ServiceInfo::new(
            &service_type,
            &instance_name,
            &hostname,
            "",
            port,
            &properties[..],
        )?.enable_addr_auto();

        daemon.register(service_info)?;
        tracing::info!("Advertised mDNS service: {} on port {}", instance_name, port);

        // Store our instance name so we can filter ourselves out
        self.our_instance_name = Some(instance_name.clone());

        let receiver = daemon.browse(&service_type)?;
        let our_name = instance_name.clone();

        let services = self.services.clone();

        let (tx, rx) = std::sync::mpsc::channel();
        {
            let mut outer_stop = self.stop_tx.lock().unwrap();
            *outer_stop = Some(tx);
        }

        thread::spawn(move || {
            let timeout = Duration::from_millis(100);
            while rx.try_recv().is_err() {
                if let Ok(event) = receiver.recv_timeout(timeout) {
                    match event {
                        ServiceEvent::ServiceFound(_, fullname) => {
                            tracing::debug!("mDNS ServiceFound: {}", fullname);
                        }
                        ServiceEvent::ServiceResolved(info) => {
                            // Skip if this is our own service
                            if let Some(entry) = create_service_entry(&info) {
                                let id = info.get_fullname().to_string();
                                // Check if this is our own instance
                                if let Some(our_name) = our_name.split('.').next() {
                                    if entry.name == our_name {
                                        tracing::debug!("Skipping our own service: {}", id);
                                        continue;
                                    }
                                }
                                if let Ok(mut services) = services.lock() {
                                    services.insert(id, entry);
                                }
                            }
                        }
                        ServiceEvent::ServiceRemoved(_, fullname) => {
                            tracing::debug!("mDNS ServiceRemoved: {}", fullname);
                            if let Ok(mut services) = services.lock() {
                                services.remove(&fullname);
                            }
                        }
                        ServiceEvent::SearchStopped(_) => {
                            tracing::debug!("mDNS SearchStopped");
                            break;
                        }
                        _ => {}
                    }
                }
            }
        });

        Ok(())
    }

    pub fn get_devices(&self) -> Vec<NearbyDevice> {
        let services = match self.services.lock() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        services
            .iter()
            .map(|(id, entry)| NearbyDevice {
                id: id.clone(),
                name: entry.name.clone(),
                device_type: entry.device_type.clone(),
                addresses: entry.addresses.clone(),
            })
            .collect()
    }
}

fn create_service_entry(info: &ServiceInfo) -> Option<ServiceEntry> {
    let fullname = info.get_fullname();
    let name = extract_instance_name(fullname)?;

    let addresses: Vec<String> = info
        .get_addresses()
        .iter()
        .map(|addr| format_address_port(addr, info.get_port()))
        .collect();

    let device_type = info
        .get_property_val_str("type")
        .map(DeviceType::from)
        .unwrap_or(DeviceType::Unknown);

    Some(ServiceEntry {
        name,
        device_type,
        addresses,
    })
}

fn extract_instance_name(fullname: &str) -> Option<String> {
    fullname.split('.').next().map(|s| s.to_string())
}

fn format_address_port(addr: &IpAddr, port: u16) -> String {
    format!("{}:{}", addr, port)
}

impl Default for NearbyDiscovery {
    fn default() -> Self {
        match Self::new() {
            Ok(n) => n,
            Err(e) => {
                tracing::error!("Failed to create NearbyDiscovery: {}", e);
                panic!("NearbyDiscovery creation failed: {}", e)
            }
        }
    }
}