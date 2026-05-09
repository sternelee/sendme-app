//! Nearby device discovery and transfer
//!
//! Provides P2P file transfer between devices on the same network.

#[cfg(not(target_os = "ios"))]
pub mod core;
#[cfg(target_os = "ios")]
pub mod core_ios;
pub mod protocol;
pub mod receiver;
pub mod sender;

#[cfg(not(target_os = "ios"))]
pub use core::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
#[cfg(target_os = "ios")]
pub use core_ios::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
pub use protocol::{FileInfo, Message, TransferManifest, ALPN};
pub use receiver::{NearbyReceiver, ReceiverEvent};
pub use sender::{NearbySender, SenderEvent};
