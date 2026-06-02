//! Nearby device discovery and transfer

#[cfg(not(target_os = "ios"))]
pub mod core;
#[cfg(target_os = "ios")]
pub mod core_ios;
pub mod protocol;

#[cfg(not(target_os = "ios"))]
pub use core::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
#[cfg(target_os = "ios")]
pub use core_ios::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
pub use protocol::{FileInfo, Message, TransferManifest, ALPN};
