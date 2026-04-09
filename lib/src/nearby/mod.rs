//! Nearby device discovery and transfer
//!
//! Provides P2P file transfer between devices on the same network.

pub mod core;
pub mod protocol;
pub mod receiver;
pub mod sender;

pub use core::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
pub use protocol::{FileInfo, Message, TransferManifest, ALPN};
pub use receiver::{NearbyReceiver, ReceiverEvent};
pub use sender::{NearbySender, SenderEvent};
