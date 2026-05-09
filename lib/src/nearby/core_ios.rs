//! Nearby device discovery using iOS Bonjour / DNS-SD.
//!
//! iOS blocks custom multicast mDNS implementations unless the app has the
//! multicast entitlement. To avoid that platform restriction, this backend uses
//! Apple's built-in Bonjour stack via the `zeroconf` crate.

use anyhow::{Context, Result};
use iroh::EndpointAddr;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use zeroconf::prelude::*;
use zeroconf::{MdnsBrowser, MdnsService, ServiceDiscovery, ServiceType as BonjourServiceType, TxtRecord};

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
const EVENT_LOOP_POLL: Duration = Duration::from_millis(250);

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
    stop_flag: Arc<AtomicBool>,
    threads: Vec<thread::JoinHandle<()>>,
    our_instance_name: Option<String>,
}

impl NearbyDiscovery {
    pub fn new() -> Result<Self> {
        Ok(Self {
            services: Arc::new(Mutex::new(HashMap::new())),
            stop_flag: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
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
        if !self.threads.is_empty() {
            return Ok(());
        }

        let instance_name = unique_instance_name(name, endpoint_addr);
        let endpoint_addr = endpoint_addr.clone();
        let device_type_for_service = device_type.clone();

        self.stop_flag.store(false, Ordering::SeqCst);

        let browser_stop_flag = self.stop_flag.clone();
        let browser_instance_name = instance_name.clone();
        let browser_services = self.services.clone();
        let browser_devices_changed = on_devices_changed.clone();
        let (browser_ready_tx, browser_ready_rx) = std::sync::mpsc::channel();
        self.threads.push(thread::spawn(move || {
            let service_type = match BonjourServiceType::new("sendme", "udp") {
                Ok(service_type) => service_type,
                Err(error) => {
                    let _ = browser_ready_tx.send(Err(anyhow::anyhow!(error.to_string())));
                    return;
                }
            };

            let mut browser = MdnsBrowser::new(service_type);
            browser.set_service_discovered_callback(Box::new(move |result, _| match result {
                Ok(discovery) => {
                    if discovery.name() == &browser_instance_name {
                        return;
                    }

                    let Some(entry) = create_service_entry(&discovery) else {
                        return;
                    };

                    let id = discovery_id_from_add(&discovery);
                    if let Ok(mut services) = browser_services.lock() {
                        let changed = services.get(&id) != Some(&entry);
                        services.insert(id, entry);
                        if changed {
                            emit_devices_changed(&services, browser_devices_changed.as_ref());
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!("Nearby Bonjour browse error: {error}");
                }
            }));

            let event_loop = match browser.browse_services() {
                Ok(event_loop) => {
                    let _ = browser_ready_tx.send(Ok(()));
                    event_loop
                }
                Err(error) => {
                    let _ = browser_ready_tx.send(Err(anyhow::anyhow!(error.to_string())));
                    return;
                }
            };

            let _browser = browser;
            run_event_loop(event_loop, browser_stop_flag, "browser");
        }));

        let service_stop_flag = self.stop_flag.clone();
        let service_instance_name = instance_name.clone();
        let service_display_name = name.to_string();
        let (service_ready_tx, service_ready_rx) = std::sync::mpsc::channel();
        self.threads.push(thread::spawn(move || {
            let service_type = match BonjourServiceType::new("sendme", "udp") {
                Ok(service_type) => service_type,
                Err(error) => {
                    let _ = service_ready_tx.send(Err(anyhow::anyhow!(error.to_string())));
                    return;
                }
            };

            let mut txt_record = TxtRecord::new();
            if let Err(error) = populate_txt_record(
                &mut txt_record,
                &service_display_name,
                &device_type_for_service,
                &endpoint_addr,
            ) {
                let _ = service_ready_tx.send(Err(error));
                return;
            }

            let advertised_port = endpoint_addr
                .ip_addrs()
                .next()
                .map(|addr| addr.port())
                .unwrap_or(0);
            let mut service = MdnsService::new(service_type, advertised_port);
            service.set_name(&service_instance_name);
            service.set_txt_record(txt_record);
            service.set_registered_callback(Box::new(|result, _| match result {
                Ok(registration) => {
                    tracing::info!(
                        "Advertised nearby Bonjour service: {}.{}",
                        registration.name(),
                        registration.domain()
                    );
                }
                Err(error) => {
                    tracing::warn!("Nearby Bonjour register error: {error}");
                }
            }));

            let event_loop = match service.register() {
                Ok(event_loop) => {
                    let _ = service_ready_tx.send(Ok(()));
                    event_loop
                }
                Err(error) => {
                    let _ = service_ready_tx.send(Err(anyhow::anyhow!(error.to_string())));
                    return;
                }
            };

            let _service = service;
            run_event_loop(event_loop, service_stop_flag, "service");
        }));

        browser_ready_rx
            .recv()
            .context("waiting for iOS Bonjour browser startup")??;
        service_ready_rx
            .recv()
            .context("waiting for iOS Bonjour service startup")??;

        self.our_instance_name = Some(instance_name);

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

impl Drop for NearbyDiscovery {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
    }
}

fn run_event_loop(
    event_loop: zeroconf::EventLoop,
    stop_flag: Arc<AtomicBool>,
    label: &'static str,
) {
    while !stop_flag.load(Ordering::SeqCst) {
        if let Err(error) = event_loop.poll(EVENT_LOOP_POLL) {
            tracing::warn!("Nearby Bonjour {label} loop error: {error}");
            thread::sleep(EVENT_LOOP_POLL);
        }
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

fn create_service_entry(discovery: &ServiceDiscovery) -> Option<ServiceEntry> {
    let txt = discovery.txt().as_ref()?;
    let endpoint_addr = endpoint_addr_from_txt(txt)?;
    let name = txt.get("name").unwrap_or_else(|| discovery.name().clone());
    let device_type = txt
        .get("type")
        .map(|value| DeviceType::from(value.as_str()))
        .unwrap_or(DeviceType::Unknown);

    Some(ServiceEntry {
        name,
        device_type,
        addresses: vec![format_address_port(discovery.address(), *discovery.port())],
        endpoint_addr,
    })
}

fn populate_txt_record(
    txt_record: &mut TxtRecord,
    name: &str,
    device_type: &DeviceType,
    endpoint_addr: &EndpointAddr,
) -> Result<()> {
    txt_record.insert("name", name)?;
    txt_record.insert("type", device_type.as_str())?;
    txt_record.insert("ver", TXT_VERSION)?;

    let endpoint = encode_endpoint_addr(endpoint_addr)?;
    let endpoint_chunks = chunk_ascii(&endpoint, ENDPOINT_CHUNK_LEN);
    txt_record.insert("ec", &endpoint_chunks.len().to_string())?;
    for (index, chunk) in endpoint_chunks.into_iter().enumerate() {
        txt_record.insert(&format!("e{index}"), &chunk)?;
    }

    Ok(())
}

fn unique_instance_name(name: &str, endpoint_addr: &EndpointAddr) -> String {
    let id_str = endpoint_addr.id.to_string();
    let suffix = &id_str[..id_str.len().min(8)];
    format!("{}-{}", name.replace(' ', "-"), suffix)
}

fn discovery_id_from_add(discovery: &ServiceDiscovery) -> String {
    browser_event_id(
        discovery.name(),
        &format!(
            "_{}._{}",
            discovery.service_type().name(),
            discovery.service_type().protocol()
        ),
        discovery.domain(),
    )
}

fn browser_event_id(name: &str, kind: &str, domain: &str) -> String {
    format!(
        "{}.{}.{}",
        name,
        kind.trim_end_matches('.'),
        domain.trim_end_matches('.')
    )
}

fn format_address_port(addr: &str, port: u16) -> String {
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

fn endpoint_addr_from_txt(txt: &TxtRecord) -> Option<EndpointAddr> {
    let count = txt.get("ec")?.parse::<usize>().ok()?;
    let mut encoded = String::new();
    for index in 0..count {
        let piece = txt.get(&format!("e{index}"))?;
        encoded.push_str(&piece);
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
