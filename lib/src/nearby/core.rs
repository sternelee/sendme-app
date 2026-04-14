//! Nearby device discovery using mDNS.
//!
//! Each advertised service carries a serialized iroh [`EndpointAddr`] for the nearby
//! control channel so peers can exchange an offer/accept flow before the actual blob
//! transfer starts.

use anyhow::{Context, Result};
use iroh::EndpointAddr;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo, TxtProperties};
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

pub const SERVICE_TYPE: &str = "_sendme._udp";
const TXT_VERSION: &str = "1";
const ENDPOINT_CHUNK_LEN: usize = 200;

type DevicesChangedCallback = Arc<dyn Fn(Vec<NearbyDevice>) + Send + Sync>;

#[derive(Clone, PartialEq)]
struct ServiceEntry {
    name: String,
    device_type: DeviceType,
    addresses: Vec<String>,
    endpoint_addr: EndpointAddr,
}

pub struct NearbyDiscovery {
    services: Arc<Mutex<HashMap<String, ServiceEntry>>>,
    daemon: Option<ServiceDaemon>,
    stop_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<()>>>>,
    our_instance_name: Option<String>,
}

impl NearbyDiscovery {
    pub fn new() -> Result<Self> {
        let services = Arc::new(Mutex::new(HashMap::new()));
        let stop_tx = Arc::new(Mutex::new(None));
        Ok(Self {
            services,
            daemon: None,
            stop_tx,
            our_instance_name: None,
        })
    }

    pub fn start(
        &mut self,
        name: &str,
        device_type: DeviceType,
        endpoint_addr: &EndpointAddr,
    ) -> Result<()> {
        self.start_with_callback(name, device_type, endpoint_addr, None)
    }

    pub fn start_with_callback(
        &mut self,
        name: &str,
        device_type: DeviceType,
        endpoint_addr: &EndpointAddr,
        on_devices_changed: Option<DevicesChangedCallback>,
    ) -> Result<()> {
        if self.daemon.is_some() {
            return Ok(());
        }

        let daemon = ServiceDaemon::new()?;
        let service_type = format!("{}.local.", SERVICE_TYPE);
        let instance_name = name.replace(" ", "-");
        let hostname = format!("{}.local.", instance_name);

        let endpoint = encode_endpoint_addr(endpoint_addr)?;
        let endpoint_chunks = chunk_ascii(&endpoint, ENDPOINT_CHUNK_LEN);
        let mut properties = vec![
            ("type".to_string(), device_type.as_str().to_string()),
            ("ver".to_string(), TXT_VERSION.to_string()),
            ("ec".to_string(), endpoint_chunks.len().to_string()),
        ];
        for (index, chunk) in endpoint_chunks.into_iter().enumerate() {
            properties.push((format!("e{index}"), chunk));
        }
        let txt: Vec<(&str, &str)> = properties
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();

        let service_info = ServiceInfo::new(
            &service_type,
            &instance_name,
            &hostname,
            "",
            0,
            txt.as_slice(),
        )?
        .enable_addr_auto();

        daemon.register(service_info)?;
        tracing::info!("Advertised nearby mDNS service: {}", instance_name);

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

        self.daemon = Some(daemon);

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
                                    let changed = services.get(&id) != Some(&entry);
                                    services.insert(id, entry);
                                    if changed {
                                        emit_devices_changed(
                                            &services,
                                            on_devices_changed.as_ref(),
                                        );
                                    }
                                }
                            }
                        }
                        ServiceEvent::ServiceRemoved(_, fullname) => {
                            tracing::debug!("mDNS ServiceRemoved: {}", fullname);
                            if let Ok(mut services) = services.lock() {
                                if services.remove(&fullname).is_some() {
                                    emit_devices_changed(&services, on_devices_changed.as_ref());
                                }
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
        snapshot_devices(&services)
    }

    pub fn get_endpoint_addr(&self, id: &str) -> Option<EndpointAddr> {
        let services = match self.services.lock() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        services.get(id).map(|entry| entry.endpoint_addr.clone())
    }
}

fn emit_devices_changed(
    services: &HashMap<String, ServiceEntry>,
    on_devices_changed: Option<&DevicesChangedCallback>,
) {
    if let Some(callback) = on_devices_changed {
        callback(snapshot_devices(services));
    }
}

fn snapshot_devices(services: &HashMap<String, ServiceEntry>) -> Vec<NearbyDevice> {
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

fn create_service_entry(info: &ServiceInfo) -> Option<ServiceEntry> {
    let fullname = info.get_fullname();
    let name = extract_instance_name(fullname)?;
    let endpoint_addr = endpoint_addr_from_txt(info.get_properties())?;

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
        endpoint_addr,
    })
}

fn extract_instance_name(fullname: &str) -> Option<String> {
    fullname.split('.').next().map(|s| s.to_string())
}

fn format_address_port(addr: &IpAddr, port: u16) -> String {
    format!("{}:{}", addr, port)
}

fn chunk_ascii(s: &str, max: usize) -> Vec<String> {
    s.as_bytes()
        .chunks(max)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect()
}

fn encode_endpoint_addr(endpoint_addr: &EndpointAddr) -> Result<String> {
    let bytes = postcard::to_stdvec(endpoint_addr).context("serializing endpoint address")?;
    Ok(data_encoding::BASE32_NOPAD.encode(&bytes))
}

fn decode_endpoint_addr(encoded: &str) -> Result<EndpointAddr> {
    let bytes = data_encoding::BASE32_NOPAD
        .decode(encoded.as_bytes())
        .context("decoding endpoint address")?;
    postcard::from_bytes(&bytes).context("deserializing endpoint address")
}

fn endpoint_addr_from_txt(txt: &TxtProperties) -> Option<EndpointAddr> {
    let count = txt.get_property_val_str("ec")?.parse::<usize>().ok()?;
    let mut encoded = String::new();
    for index in 0..count {
        let piece = txt.get_property_val_str(&format!("e{index}"))?;
        encoded.push_str(piece);
    }
    decode_endpoint_addr(&encoded).ok()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr};

    #[test]
    fn endpoint_addr_roundtrips_through_txt_encoding() {
        let endpoint_addr = EndpointAddr::new(iroh::SecretKey::generate(&mut rand::rng()).public())
            .with_ip_addr(SocketAddr::from((Ipv4Addr::LOCALHOST, 7001)));
        let encoded = encode_endpoint_addr(&endpoint_addr).unwrap();
        let decoded = decode_endpoint_addr(&encoded).unwrap();
        assert_eq!(decoded, endpoint_addr);
    }
}
