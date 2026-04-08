//! Nearby device discovery and transfer
//!
//! Provides P2P file transfer between devices on the same network.

pub mod protocol;
pub mod core;
pub mod sender;
pub mod receiver;

pub use core::{DeviceType, NearbyDevice, NearbyDiscovery, SERVICE_TYPE};
pub use protocol::{ALPN, Message, FileInfo, TransferManifest};
pub use sender::{NearbySender, SenderEvent};
pub use receiver::{NearbyReceiver, ReceiverEvent};